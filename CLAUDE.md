# CLAUDE.md

Guidance for working in this repo. See [README.md](README.md) for the product overview.

## What this is

A monorepo (npm workspaces, TypeScript, ESM) tracking NJ Transit rail reliability: `pipeline` ingests NJT feeds → `db` (SQLite) → `api` (Hono, read-only) → `app` (Expo Router, web+iOS+Android). `shared` holds types/constants/pure utils.

**Dependency rule (enforced by package boundaries):** `app` imports only `@njt/shared`. Only `pipeline` and `api` import `@njt/db`. The frontend never queries the database directly.

## Commands

```bash
npm install                      # from repo root
npm test                         # Vitest: shared, db, pipeline, api, app/lib
npm test --workspace app         # jest-expo component tests (.test.tsx only)
npm run typecheck                # strict tsc for the 4 node packages
npm run typecheck --workspace app
npm run seed                     # synthetic data → ./data/njt.sqlite
npm run api                      # start API (env: NJT_DB_PATH, PORT)
npm run pipeline                 # start ingest worker (needs NJT creds)
npm run app -- --web             # Expo web dev server
```

## Conventions

- **Time:** instants are epoch **seconds** (UTC) unless the field ends in `Ms` (epoch ms). Service dates are `YYYY-MM-DD`. All NJT-local math goes through `shared/src/time.ts` (timezone via `Intl`, `America/New_York`).
- **Aggregates are daily.** The pipeline (`pipeline/src/aggregator.ts`, pure `computeAggregates`) writes per-day rollups; the API sums them over a range. Add new metrics as daily rows, not request-time queries.
- **DB access:** repositories only. Use the typed `Database.all<T>/get<T>/run` helpers (they cast the loose `node:sqlite` rows). Booleans are stored 0/1; map fields are JSON TEXT.
- **Schema changes:** append a migration to `db/src/schema.ts` — never edit an applied one.
- **Pipeline I/O is injected** (`Clock`, `FeedClient`, repos) so logic is unit-tested with fakes; HTTP/protobuf parsing lives at the edges.
- **Frontend logic** lives in `app/lib/` (pure, no React Native — tested by Vitest). Screens/components are thin wrappers; charts render pure geometry from `app/lib/charts.ts`.

## Testing notes

- Node packages: Vitest, in-memory SQLite (`openDatabase()`), no network.
- App components: **jest-expo with `@testing-library/react-native@13`** (v14's renderer is incompatible with jest-expo 56). Destructure queries from `render()` rather than the global `screen`.
- React/React Native versions are pinned by Expo SDK 56 (`expo install --fix` to realign). Don't add root `overrides` for `react` — it fights the SDK pins.
