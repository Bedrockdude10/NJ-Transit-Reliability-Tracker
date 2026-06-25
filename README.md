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

### Seed demo data

The pipeline needs live NJT credentials to collect real data, but you can populate a database with realistic synthetic data to explore everything locally:

```bash
npm run seed          # writes ./data/njt.sqlite (≈30 days of events + aggregates)
```

### Run the components

```bash
# API (reads ./data/njt.sqlite by default; serves on :4000)
NJT_DB_PATH=./data/njt.sqlite PORT=4055 npm run api

# Frontend (web). Point it at the API:
EXPO_PUBLIC_API_URL=http://localhost:4055 npm run app -- --web
# iOS / Android:
EXPO_PUBLIC_API_URL=http://localhost:4055 npm run app   # then press i / a

# Ingest pipeline (needs real NJT credentials — see .env.example)
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
