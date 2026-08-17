# Versioning the contract

Plan, not yet executed. Written 2026-08-16.

How `contract/v1` gets from this repo to [njt-delay-modeling](https://github.com/Bedrockdude10/njt-delay-modeling)
today, why the two repos cannot currently move independently, and the three
changes that fix it. Companion to the contract sections of
[CLAUDE.md](CLAUDE.md), which describe the contract as it stands.

## The problem

The contract is distributed by **filesystem adjacency and branch HEAD**. Nothing
in the path from producer to consumer carries a version number:

```
this repo, main @ HEAD  ──(unpinned actions/checkout)──►  modeling repo CI
contract/v1/            ──(hardcoded ../ sibling path)──►  modeling repo pytest
```

So the modelling repo does not depend on *a* contract. It depends on whatever
this repo's `main` says at the moment its build runs. Four consequences, all
observed rather than theorised:

1. **A merge here turns that repo red, with no commit there.** Its
   `.github/workflows/ci.yml` checks this repo out with no `ref:` — default
   branch, HEAD. Live example: `ad58501` added `units.json` and
   `predictionIntervalPercent`; that repo's CI went red on `main` for a change
   made in this one.
2. **A contract change can never land atomically.** CI here only asserts that
   `npm run emit:data-contract` is a no-op — it never builds the consumer. So the
   ordering is forced: merge here (green), and the modelling repo is broken until
   a second PR lands there. CLAUDE.md describes that window; nothing closes it.
3. **An additive change is a flag day at runtime.** The consumer reads with
   pydantic `extra="forbid"` and a pandera schema at `strict=True`
   (`storage.py:499`, `frames.py:214`). A new optional field on `TripStopEvent`
   makes the deployed producer's rows fail validation **one hundred percent** —
   not degrade, fail. This contradicts CLAUDE.md's "adding an optional field is
   not a breaking change": in the contract's own terms it isn't, in the
   consumer's runtime behaviour it is.
4. **Its staleness test covers half the contract, and mutates the tree.**
   `test_regenerating_changes_nothing` snapshots `*.py` before and after, but
   `sync_contract.py` also copies every `*.json` verbatim — so schemas,
   `datasets.json`, `manifest.json` and `units.json` are overwritten and never
   compared. The test passes while the vendored contract is stale. Worse, it
   writes into the real tracked `contract/` directory, so running pytest dirties
   the working tree.

What is *not* wrong: generating rather than hand-writing on both sides, vendoring
the generated models into the consumer, and the runtime `manifest.json` digest
check. Those stay exactly as they are. The digest check in particular is the only
guard that catches a *deployed* producer running older code than the consumer,
which no comparison of two checkouts can see.

The imbalance is that this seam has excellent drift **detection** and near-zero
drift **tolerance**. Detection tells you something moved. Tolerance is what lets
the two repos move at different times.

## The fix

Publish the contract as a versioned artifact; the consumer pins a version. This
is the ordinary pattern — Buf, Confluent Schema Registry, and "publish the
generated client to npm/PyPI and pin it" are all implementations of it. **Built
2026-08-16**; what follows describes what is in the two repos now.

An earlier draft of this plan carried more machinery than it needed — a release
pipeline with assets, a bespoke fetch-and-cache, and a hand-rolled bump workflow.
Each was reimplementing something that already exists (git, git again, Renovate),
so each came out. What is left is a tag, a pin, and two config flags.

### 1. This repo: tag the contract when it changes

[`.github/workflows/contract-tag.yml`](.github/workflows/contract-tag.yml) tags
`main` as `contract-v1.N` on any push touching `contract/`. No release assets:
the consumer clones the tag, and a tarball would be a second copy of something
git already serves.

The tag is a **fetch handle, not a version with meaning of its own.** The
contract's identity is already `manifest.json`'s digest — computed over every
contract file, published into the bucket, and compared at runtime. Minting a
semver with independent semantics would be a second source of truth free to
disagree with the first, so the digest goes in the tag message instead and the
workflow skips tagging when the digest is unchanged (a comment or a reordering in
`contract/` is not a new contract). `v1` keeps its existing meaning: the
compatibility version, where a breaking change is a new `contract/v2/` directory
and never an edit.

### 2. Modeling repo: pin the tag, fetch by tag

- The pin is `[tool.njt] contract_tag` in `pyproject.toml`.
- `sync_contract.py` clones that tag — shallow, blobless, sparse — into a temp
  directory. git is the fetcher and the cache; a bespoke one would be
  reimplementing it badly. `--source` still takes a local directory, which is how
  you try a contract change before it is tagged, and `--ref` overrides the pin.
- `ci.yml` no longer checks this repo out at all. It syncs from the pin and fails
  on `git status --porcelain` — porcelain rather than `git diff`, matching this
  repo's own check, because `git diff` is blind to untracked files and a newly
  *added* contract file is exactly what slipped through before.
- Both `pytest.skip("ingest repo not checked out alongside")` branches are gone.

Taking a contract change is now an ordinary PR **in the modelling repo**: bump the
pin, regenerate, and the models, the tripwire updates, and the work the new field
unblocks land together in one green commit. `renovate.json` opens that PR when a
new tag appears, so a change here still surfaces immediately — as a PR rather than
as a broken build. A *major* bump is disabled there deliberately: `contract/v2` is
a migration someone decides to do, not a dependency update.

### 3. Modeling repo: tolerate unknown fields on read

Strict on **write**, filtered-and-logged on **read**. Both are library settings,
not machinery — pandera's `strict="filter"` and a key filter before
`model_validate`.

Which one applies is derived from `datasets.json`'s `written_here`, so the
direction of travel is stated once and read twice rather than restated:

- **Written here** (`predictions/`, `scorecards/`) stays strict. Publishing an
  unagreed shape is this repo's own bug and should be impossible.
- **Read here** (`events/`) filters unknown columns and logs them once.

This is the change that actually decouples the two repos, and the one to keep if
the rest is ever unwound. The pin controls *when* a contract change is taken; the
read tolerance is what makes "not yet" a safe answer. Before it, an additive
field — explicitly *not* a breaking change by the contract's own rules — failed
every row the instant the producer deployed, so the two repos had to ship
together. The log is the other half: filtering in silence would trade a loud
wrong answer for a quiet one.

### Alongside: the two bugs in `test_contract.py`

- `test_regenerating_changes_nothing` generates into a `tmp_path` and compares,
  so running pytest no longer rewrites vendored files in the working tree.
- The JSON is covered by CI's porcelain check against the pinned tag, and the
  vendored JSON is separately tied to the vendored models by the existing digest
  test. The offline test asserts models-match-schemas; the CI step asserts
  schemas-match-the-tag. Neither can pass while the other is stale.

## What is left to do

**Create the first tag.** `contract-v1.1` is pinned but does not exist yet —
`sync_contract.py` fails with a message saying so, and `--source` is the
documented way to work until it does. Either merge any `contract/` change and let
the workflow mint it, or tag the current contract by hand:

```
git tag -a contract-v1.1 -m "contract/v1 @ $(jq -r .digest contract/v1/manifest.json)"
git push origin contract-v1.1
```

**Enable Renovate** on the modelling repo if it is not already; `renovate.json`
is inert until the app is installed.

The token question an earlier draft raised is gone. Renovate runs as its own app
and needs no PAT, and the tagging workflow uses `GITHUB_TOKEN` against its own
repo, which is exactly what it is scoped for.
