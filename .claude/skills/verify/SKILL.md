---
name: verify
description: Run this repo's full verification gate before committing. Use before any commit or push, or when asked to check that everything passes.
---

# Verify

Run all of it. The regeneration steps at the end are the ones everyone forgets and the
ones CI actually rejects the push for.

```bash
npm run lint
npm run typecheck
npm run typecheck --workspace app
npm test
npm test --workspace app
```

Then prove the generated artifacts still match their sources:

```bash
npm run generate:contract && npm run emit:data-contract && git diff --exit-code contract/ shared/src/*.zod.ts
```

If that last diff is non-empty, the commit is incomplete — the generated files are
checked in, so regenerate and include them. A non-empty `contract/` diff also means the
object-storage contract changed: that tags a new `contract-v1.N` on merge and opens a
bump PR in `njt-delay-modeling`, so make sure the change is one you meant (an added
optional field or annotation is fine; anything breaking is a new `contract/v2/`, never an
edit — see `CONTRACT-VERSIONING.md`).

For a diff that is meant to touch only comments, add:

```bash
npm run lint:comments
```

That strips comments from both sides and proves the code is unchanged; it accepts a
base ref argument (default `HEAD`), e.g. `npm run lint:comments origin/main`. CI runs
the same gate on PRs and fails when comment edits are mixed into a code change.
