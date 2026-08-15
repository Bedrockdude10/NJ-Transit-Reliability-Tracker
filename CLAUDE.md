# CLAUDE.md

Guidance for working in this repo. See [README.md](README.md) for the product overview.

## What this is

A monorepo (npm workspaces, TypeScript, ESM) tracking NJ Transit rail reliability: `pipeline` ingests NJT feeds → `db` (SQLite) → `api` (Hono, read-only) → `app` (Expo Router, web+iOS+Android). `shared` holds types/constants/pure utils.

**Dependency rule (enforced by package boundaries):** `app` imports only `@njt/shared`. Only `pipeline` and `api` import `@njt/db`. The frontend never queries the database directly.

## Architecture

Data flow (every source is real; GTFS static + performance CSVs are keyless, the GTFS-RT/XML real-time feeds + getGTFS need the NJT token):

```
GTFS static ──────────┐  import:gtfs / getGTFS ─┐
Performance CSVs ─────┼─ import:official ────────┤    ┌──────────────┐      ┌────────────┐  HTTP/JSON   ┌────────────┐
GTFS-RT + XML (TOKEN) ┘  pipeline worker ────────┼──write─►│ SQLite (db)  │◄read─│ api (Hono) │─(@njt/shared)─►│ app (Expo) │
                                                  │        │  daily rows  │      │ sums range │   DTOs        │ web/iOS/And│
                                                  └────────►└──────────────┘      └────────────┘              └────────────┘
```

There is **no synthetic data**: all measurement comes from the live GTFS-RT feed. (A seed used to fabricate independent measurements before the API was connected; it has been removed.)

Package deps (compile-enforced — see Dependency rule):

```
shared ◄── db ◄── pipeline
   ▲        ▲
   │        └──── api
   └───────────── app        (app depends on shared ONLY)
```

Request lifecycle, e.g. `GET /lines/:id/summary?from&to`:

```
route handler → resolveRange(from,to) → repo.getOtpDailyRows(range)  ← sums small daily rows,
              → aggregation.buildOtpSummary(...) → JSON (a @njt/shared DTO)    never scans raw events
```

Pipeline tick: `fetch (FeedClient) → parse → repos.events.record → aggregator.recomputeServiceDate(date)` (pure `computeAggregates` does the math; persistence is a thin wrapper).

## Where to add things

- **New screen:** `app/app/<route>/index.tsx` + a link in `app/components/NavBar.tsx`. Fetch via `app/lib/api.ts` (`useApi` / `useApis` / `useLiveApi`, thin wrappers over TanStack Query). Client methods return an `ApiQuery` — a cache key plus how to run it — not a promise, so the key is always the URL and can never disagree with the request.
- **Screens are panels under `<QueryBoundary>`.** `data` from the hooks is non-nullable; a screen never writes a `loading ? … : error ? …` ladder. Put each panel's query in its own child component under its own boundary: siblings fetch in parallel, whereas stacking several `useSuspenseQuery` calls in one component suspends on the first and serialises them. **Anything that fetches inside `app/_layout.tsx` needs its own boundary** — without one it suspends or crashes the whole app shell, not just itself.
- **A query that can't run yet is not a disabled query** — don't render the component that needs it (`/commute` does this). Suspense queries have no `enabled`.
- **Screen state that a user would share or return to belongs in the URL**, via `useWindow()` or `useLocalSearchParams`, not `useState`.
- **New API endpoint:** `api/src/routes/<group>.ts`, mount in `api/src/app.ts`; add the response DTO to `shared/src/api.ts` and a client method to `app/lib/api.ts`.
- **New metric:** emit a daily row in `pipeline/src/aggregator.ts`, store it via `db/src/repositories/aggregates.ts` (add a migration), sum it in `api/src/aggregation.ts`, surface in a DTO + screen. Don't compute it at request time.
- **New data source:** an importer under `pipeline/src/<source>/` + a repository + a migration; keep HTTP/parse at the edges, logic pure.

## Commands

```bash
npm install                      # from repo root
npm test                         # Vitest: shared, db, pipeline, api, app/lib
npm test --workspace app         # jest-expo component tests (.test.tsx only)
npm run typecheck                # strict tsc for the 4 node packages (also proves api.zod.ts matches api.ts)
npm run generate:contract        # regenerate shared/src/api.zod.ts from api.ts (ts-to-zod)
npm run typecheck --workspace app
npm run import:gtfs              # real GTFS static network (stops/coords/lines/colors/trips) from a local dir
npm run import:official          # real NJT monthly OTP + cancellations + MDBF + light rail from CSVs in ./data (keyless)
npm run repair:line-names        # one-off: repoint events stored under a raw feed route_id, then recompute
npm run purge:seed               # one-off: delete the pre-API seed's fabricated events (preview; -- --apply to write)
npm run replay                   # re-derive events from raw_snapshots (preview; -- --apply to write)
npm run snapshot                 # verified, gzipped copy of the live db (safe against a running pipeline)
npm run api                      # start API (env: NJT_DB_PATH, PORT)
npm run pipeline                 # start ingest worker (needs NJT creds; also fetches getGTFS + records live events)
npm run web --workspace app      # Expo web dev server (ios/android scripts too)
```

## Deployment

See [DEPLOY.md](DEPLOY.md). Tier 1: pipeline + API ship as **one container** (`Dockerfile` → `deploy/start.mjs` supervisor) sharing one SQLite file on a **persistent volume** (`fly.toml`, region `ewr`); the pipeline only starts when `NJT_RAIL_DATA_USERNAME` is set, so the API can launch first. The Expo web app exports static (`web.output: "single"` + `app/public/_redirects` SPA fallback) to Cloudflare Pages with `EXPO_PUBLIC_API_URL` pointing at the API. Never scale the machine to zero (continuous polling). `npm run bootstrap` = import GTFS + official on the server (measurement then accrues from the live feed — no synthetic data).

## Conventions

- **Time:** instants are epoch **seconds** (UTC) unless the field ends in `Ms` (epoch ms). Service dates are `YYYY-MM-DD`. All NJT-local math goes through `shared/src/time.ts` (timezone via `Intl`, `America/New_York`).
- **Aggregates are daily.** The pipeline (`pipeline/src/aggregator.ts`, pure `computeAggregates`) writes per-day rollups; the API sums them over a range. Add new metrics as daily rows, not request-time queries.
- **DB access:** repositories only. Use the typed `Database.all<T>/get<T>/run` helpers (they cast the loose `node:sqlite` rows). Booleans are stored 0/1; map fields are JSON TEXT.
- **Schema changes:** append a migration to `db/src/schema.ts` — never edit an applied one.
- **Official NJT metrics** are real and come from `pipeline/src/official/njt-performance.ts` (per-line CSVs, keyed by filename code → catalog name). The API derives the *system* official figure as the trips-weighted aggregate of the per-line metrics — don't import the systemwide CSV separately (it's redundant and would double-count).
- **GTFS static** maps GTFS `route_short_name` → canonical catalog line, collapses variant routes (NJCL + NJCLL → one; Main/Bergen/Port Jervis → `main-bergen`), keeps real colors + coordinates, and excludes light rail (`route_type` 0). The route mapping is shared (`pipeline/src/gtfs-static/route-mapping.ts`, accepts rail `route_type` **2 or 113**) between two ingest paths: the `import:gtfs` CLI (`gtfs/import-static.ts`, from a local dir) and the pipeline's **startup getGTFS sync** (`gtfs-static/parse.ts` + `load.ts`, fetched from NJT's own API via the token). **Prefer getGTFS** — its numeric `route_id`/`stop_id`/`trip_id` match the real-time feed, so RT trips resolve to real stations/lines; a third-party mirror's ids won't. It becomes the current GTFS version, so the app runs on the real network.
- **No synthetic data.** All measurement (OTP, delays, station stats, connections) is derived from the live GTFS-RT feed. There is no seed — the independent metrics are honestly empty/sparse until real data accrues. `deploy/purge-synthetic.mjs` clears any pre-API synthetic data left in a database (keeps `gtfs_*` + `official_*`).
- **Map:** `/map` returns real geometry (stop coords + per-line stop paths), colors, and OTP. `SystemMap` projects lat/lon (cosine-latitude correction) over the union of stations and `NJ_STATE_OUTLINE` (`shared/src/geo.ts`, a coarse silhouette) and colors lines by reliability or NJT color.
- **`npm run archive:copy`** drains `raw_snapshots` to object storage (one object per blob, whole closed UTC hours, `Content-MD5`-verified by the store before anything is deleted) and is what keeps the volume from filling — it deliberately does not `VACUUM`, so the file stops growing rather than shrinking. The supervisor runs it hourly once `NJT_ARCHIVE_COPY_ENABLED=true`. It uses no query engine on purpose: an earlier DuckDB/Parquet version peaked at 444 MB on a 470 MB machine and was OOM-killed, since DuckDB plus its extensions costs ~211 MB before reading a row. Copy before enabling Litestream: replicating a 3.7 GB database starved the API and caused an outage.
- **`npm run export:events`** publishes derived events to object storage as **gzipped JSON Lines**, one hive-partitioned object per service date (`events/service_date=…/events.jsonl.gz`), for the Python modelling repo; the supervisor runs it daily once `NJT_EVENTS_EXPORT_ENABLED=true`. Records are the `TripStopEvent` domain objects the contract is generated from, so there's no projection to keep in step — a test round-trips real rows through SQLite and asserts the JSON keys equal the contract's. Not Parquet: writing it needed DuckDB, which costs ~211 MB resident before reading a row and cannot run on this machine. The consumer converts to Parquet on its own hardware; `contract/v1` describes records, not an encoding.
- **Object storage is the seam with the modelling repo, not an API.** Training reads bulk history, so it reads immutable per-day objects it can re-read identically next year; an endpoint would serve whatever the database says now, would put a training job on the request path of a 512 MB machine, and would reimplement a filesystem. Predictions come back the same way (`predictions/`), to be pulled into SQLite rather than read from R2 on request.
- **The object-storage contract lives in `contract/v1/*.json`** — generated by `npm run emit:data-contract` from `domain.ts` / `predictions.ts` (records, via Zod) and **`shared/src/datasets.ts` (the bucket layout)**. It is the seam with the Python modelling repo (`njt-delay-modeling`), which generates pydantic models from it and vendors the whole directory. TypeScript is the schema authority for every data contract; a breaking change means a new `contract/v2/`, never an edit. Mark genuinely-integer fields `@format int` — TS has no integer type, and without it epoch fields become floats downstream.
- **Never hardcode a prefix, suffix or key.** `shared/src/datasets.ts` is the single definition of *where* each dataset lives and how it is encoded; both repos build keys from it (`datasetKey()` here, `object_key()` there). A layout written out twice is drift that fails **silently** — the reader finds no objects and reports success, and a model trains on an empty frame.
- **Drift is caught in three places, because each misses what the others can't see.** (1) CI here re-emits the contract and fails if anything changed — so `contract/v1` always matches the types. (2) CI there re-syncs and diffs — so its pydantic models and vendored layout always match `contract/v1`. (3) At runtime the exporter publishes `contract/v1/manifest.json` (a sha256 over every contract file) into the bucket, and the reader compares it against the digest it was generated from — which is the only one that catches a *deployed* producer running older code than the consumer.
- **The contract is `@njt/shared`** — all DTOs (`api.ts`), domain types (`domain.ts`), constants, and pure math live there; it's the single source of truth and the only thing `app` may import. Add a type once, here. `api.zod.ts` is its **generated** runtime shadow (`npm run generate:contract`) — never hand-edit it; the app validates every response against it, because api and app deploy independently and can drift.
- **Time:** `time.ts` is `Intl`-only and app-safe; the DST-sensitive local-parts→instant direction lives in `time-zoned.ts` behind `@njt/shared/zoned` so the Temporal polyfill stays out of the app bundle (`shared/test/bundle-boundary.test.ts` enforces it). GTFS stop times anchor at **noon−12h**, per spec, not local midnight.
- **Pipeline I/O is injected** (`Clock`, `FeedClient`, repos) so logic is unit-tested with fakes; HTTP/protobuf parsing lives at the edges.
- **Every outbound NJT call has a deadline** (`FEED_TIMEOUT_MS`, `GTFS_STATIC_TIMEOUT_MS` in `pipeline/src/feeds.ts`). Without one a hung connection stalls ingest silently — `/health` keeps returning 200, since the API is a separate process.
- **Logging is `@njt/shared/logger`** (JSON lines, server-only subpath so it stays out of the app bundle). Inject it into `createApp(repos, log)`; tests pass `silentLogger`. `console.log` is for CLI scripts only.
- **The supervisor restarts a dead child** rather than tearing the machine down (`deploy/restart-policy.mjs`, tested). Only a crash loop escalates. The two processes can't be split into separate Fly machines — a volume attaches to one machine and they share the SQLite file.
- **Durability:** `npm run snapshot` writes a verified gzipped copy (a restore point, still on the volume); Litestream replicates the WAL off-box continuously and restores on boot if the volume is empty (`deploy/litestream.yml`, off until `LITESTREAM_*` is set). Config is 0.5.x format — `replica:` singular, global `snapshot:` block; 0.3.x examples won't load.
- **Frontend logic** lives in `app/lib/` (pure, no React Native — tested by Vitest). Screens/components are thin wrappers; charts render pure geometry from `app/lib/charts.ts`.

## Testing notes

- Node packages: Vitest, in-memory SQLite (`openDatabase()`), no network.
- App components: **jest-expo with `@testing-library/react-native@13`** (v14's renderer is incompatible with jest-expo 56). Destructure queries from `render()` rather than the global `screen`.
- React/React Native versions are pinned by Expo SDK 56 (`expo install --fix` to realign). Don't add root `overrides` for `react` — it fights the SDK pins.
