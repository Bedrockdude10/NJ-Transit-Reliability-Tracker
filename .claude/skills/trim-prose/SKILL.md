---
name: trim-prose
description: Trim over-long comments from source files in this repo. Use when asked to reduce comments, prose, or verbosity in code, or when a file's doc blocks restate CLAUDE.md.
---

# Trim prose

Source files carry the code and the few facts a reader cannot recover from it.
Everything else lives in `CLAUDE.md` / `DEPLOY.md` / `README.md` — or nowhere.

## Interlocks — read before touching anything

1. **`@unit` and `@format int` are code, not prose.** `scripts/emit-data-contract.ts`
   reads them out of `shared/src/domain.ts` and `predictions.ts` and emits them into
   `contract/v1/*.json`. Never strip one. Per-field *prose* is not emitted, so the
   surrounding sentences are free to cut.
2. **`contract/v1/*.json` descriptions are payload, not comments.** They come from
   string literals in `scripts/emit-data-contract.ts` and the `description` fields in
   `shared/src/datasets.ts`. Never alter those string values — they ship to the Python
   modelling repo.
3. **ts-to-zod copies JSDoc verbatim** into `shared/src/{api,domain,predictions}.zod.ts`.
   Never hand-edit those. Trim the sources, then `npm run generate:contract`.
4. **SQL `--` comments inside migration template literals are code**, not comments — the
   gate below fails on them, and an applied migration is never edited anyway.

## The rule

**Delete a comment when** it: restates the code or the type; narrates history ("used to
be…", "an earlier version…", "which is what happened when…"); explains the architecture,
the deploy topology, or a convention already in `CLAUDE.md`/`DEPLOY.md`; justifies a
library or design choice at length; is a section banner (`// --- foo ---`); or is a
`@param`/`@returns` that adds nothing to the signature.

**Keep, at ≤3 lines, when** it records something the reader cannot recover from the code
and would plausibly *undo*:

- a non-obvious constraint (`node:sqlite`'s `BEGIN` does not nest)
- why the obvious implementation is wrong here (`VACUUM INTO` copies the database as of
  its start instant, so swapping in a stale copy drops ingest)
- a magic number's provenance, an upstream bug or vendor quirk worked around, a spec
  citation (GTFS stop times anchor at noon−12h, per spec)
- `@unit` / `@format int` — always

**Rewrite, don't delete, when** a 15-line essay contains one such fact: keep the fact,
drop the essay. One sentence beats a paragraph.

**Never invent a justification you can't see in the code.** If a block asserts something
you cannot verify, delete it rather than paraphrase it — a confident wrong comment is
worse than none.

**Default to delete.** Do not relocate rationale into `README.md`/`DESIGN.md` to "save"
it; that recreates the problem one directory over. Rationale belongs in the commit
message and the PR. The one exception: a genuinely *operational* fact (someone running
this system at 3am needs it) that is in no doc — add one bullet to `DEPLOY.md` and say so
in your report.

Expect roughly a 50–60% cut. That is a number to spot-check against, not a quota:
deleting a load-bearing constraint to hit it makes the repo worse.

## Gate

```bash
npx tsx scripts/check-comments-only.ts
```

Strips comments from both sides of the diff and compares the emitted code, so a
comments-only claim is provable in one command. If it flags a file, you changed code —
look before committing.
