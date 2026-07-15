# NJ Transit Reliability Tracker

Independent, per-train reliability tracking for NJ Transit commuter rail — the real delay picture NJT's monthly "on-time %" hides. It continuously ingests NJT's public feeds, computes on-time performance at strict thresholds (5/10/15/30/60 min) next to NJT's loose 6-minute figure, and models the probability of making timed transfers.

> **Disclaimer:** Data is sourced from NJ Transit's public feeds and is independent of NJT official reporting. It is not guaranteed accurate, complete, or real-time.

## Architecture

Four decoupled components in one monorepo. The pipeline never serves the frontend; the frontend never touches the database. The API is the only bridge.

```
pipeline ── writes ──▶ database ◀── reads ── api ◀── HTTP ── app (web + iOS + Android)
(long-running)        (SQLite)      (Hono, read-only)        (Expo Router)
```

The workspace layout enforces the data-flow rule structurally: **`app` depends only on `shared`** (never `db`); only `pipeline` and `api` depend on `db`.

| Package | What it is |
|---|---|
| [`shared`](shared) | Domain types, constants, and pure utilities (timezone/delay math). No I/O — safe to bundle into the app. |
| [`db`](db) | SQLite data layer (`node:sqlite`): schema, migrations, repositories. |
| [`pipeline`](pipeline) | Long-running ingest worker: polls feeds, parses GTFS-RT/static, computes aggregates, rate-limits, tracks health. |
| [`api`](api) | Stateless read-only HTTP API (Hono). Serves pre-computed daily aggregates, summed over any date range. |
| [`app`](app) | Expo Router frontend targeting web, iOS, and Android from one codebase. |

### Key design decisions

- **`node:sqlite`** (built into Node 22+) — no native module to compile, synchronous API ideal for the pipeline, in-memory databases for tests. Wrapped behind a thin `Database` class so it can be swapped for Postgres.
- **Daily aggregates are the atomic unit.** The pipeline pre-computes per-day rollups; the API sums those small rows over any requested range. This satisfies *both* "no expensive aggregation at request time" and "any date range can be queried."
- **Charts** are built on `react-native-svg` with the geometry extracted into pure, unit-tested functions — cross-platform by construction.

## Getting started

Requires **Node 22+** (developed on Node 25). Install once from the repo root:

```bash
npm install
```

### Load the real data

Everything uses **real** data. The keyless imports set up the network + NJT's published figures; the independent measurement comes from the live GTFS-RT feed (needs NJT credentials — see below). There is **no synthetic data**. The recommended local setup, in order:

```bash
npm run import:gtfs        # real GTFS static network: stops+coords, lines+colors, trips (NJT_GTFS_DIR, default ./data)
npm run import:official    # real NJT monthly OTP/cancellations per line + light rail (NJT_PERFORMANCE_DIR, default ./data)
```

- **GTFS static** is keyless — download the NJ Transit *Rail* feed from the Mobility Database (`mobilitydatabase.org`) or `developer.njtransit.com` and unzip it under `./data/` (e.g. `./data/mdb-…/`). This drives the real station map, line list, and geometry. With NJT credentials the pipeline instead fetches NJT's own GTFS (`getGTFS`) at startup, whose ids match the real-time feed.
- **Official figures** are also keyless — download the per-line rail CSVs from `njtransit.com/performance-data-download` into `./data/`.

So a complete local setup is `npm run import:gtfs && npm run import:official` plus the pipeline with credentials. Until live collection runs, the independent measurement is simply empty — the app shows NJT's real published numbers and labels the independent metrics as still accruing rather than inventing data.

### Run the components

Each in its own terminal. (Run these as-is — don't paste trailing comments; zsh doesn't strip them.)

Start the API (reads `./data/njt.sqlite`, serves on the chosen port):

```bash
NJT_DB_PATH=./data/njt.sqlite PORT=4055 npm run api
```

Run the web frontend, pointed at that API:

```bash
EXPO_PUBLIC_API_URL=http://localhost:4055 npm run web --workspace app
```

For iOS / Android, use `npm run ios --workspace app` or `npm run android --workspace app` (or `npm run start --workspace app` and press `i` / `a`).

Run the ingest pipeline (needs real NJT credentials — see `.env.example`):

```bash
npm run pipeline
```

## Testing

This is a test-infected project. Two runners:

```bash
npm test                      # Vitest: shared, db, pipeline, api, and the app's pure logic (125 tests)
npm test --workspace app      # jest-expo: React Native component tests
npm run typecheck             # strict tsc across shared/db/pipeline/api
npm run typecheck --workspace app
```

## NJT data sources & credentials

Credentials are read from the environment only and never committed (see [`.env.example`](.env.example)). Register at `developer.njtransit.com` (GTFS + GTFS-RT) and `datasource.njtransit.com` (XML train-control API).

The pipeline respects NJT's daily request budgets (100k GTFS-RT, 40k XML), keeps ≥20% headroom, and degrades gracefully under pressure — extending the TripUpdates interval and dropping VehiclePositions before ever dropping TripUpdates.

## Deployment

- **Pipeline** — any host that runs a persistent process (not serverless).
- **API** — stateless; serverless functions or a small server both work.
- **Frontend web** — static hosting (`expo export --platform web` → Vercel/Netlify).
- **Frontend mobile** — Expo EAS → App Store / Play Store.

## Compliance

NJT's terms disclaim feed accuracy and require data be hosted on the developer's own server (no proxying the raw feed). The dashboard shows the disclaimer on every screen, never displays NJT's logo or implies endorsement, and publishes pipeline uptime and known data gaps for transparency.
