# NJ Transit Reliability Tracker

Independent, per-train reliability tracking for NJ Transit commuter rail — the real delay picture NJT's monthly "on-time %" hides. Continuously ingests NJT's public feeds, computes on-time performance at strict thresholds (5/10/15/30/60 min) next to NJT's loose 6-minute figure, and models the probability of making timed transfers.

> **Disclaimer:** Data is sourced from NJ Transit's public feeds and is independent of NJT official reporting. It is not guaranteed accurate, complete, or real-time.

## What it does

**For riders**

- **Live departure board** at every station — next trains with destination, live predicted delay, and cancellations shown in their scheduled slot rather than silently dropped.
- **Live map** — every reporting train as a chevron pointing the way it's heading. Positions older than five minutes are withheld, and the count of what was hidden is shown.
- **Your commute** — pick two stations and see how *that* journey performs: on-time rate, the delay to plan around (p90), and which timetabled departure is most and least reliable.

**For the agency**

- **Where delay accumulates** — average delay at each stop along a route, differenced stop to stop, so the costliest stretches and the places trains recover are both visible.
- **Station rankings** — ordered by arrival delay (where lateness is *felt*) and separately by amplification: trains that arrive on time and still leave late, which is delay a station introduces rather than inherits.
- **Independent OTP at strict thresholds** next to NJT's own 6-minute figure, per line and per month, back to 2017.

Every measured figure comes from the live GTFS-Realtime feed. Where the sample is too thin to support a number, the app says so instead of printing one.

## Getting started

Requires **Node 22+** (developed on Node 25). Install once from the repo root:

```bash
npm install
```

Load the real data (keyless imports; all real, no synthetic data):

```bash
npm run import:gtfs        # real GTFS static network: stops+coords, lines+colors, trips (NJT_GTFS_DIR, default ./data)
npm run import:official    # real NJT monthly OTP/cancellations per line + light rail (NJT_PERFORMANCE_DIR, default ./data)
```

- **GTFS static** is keyless — download the NJ Transit *Rail* feed from the Mobility Database (`mobilitydatabase.org`) or `developer.njtransit.com` and unzip it under `./data/` (e.g. `./data/mdb-…/`). With NJT credentials the pipeline instead fetches NJT's own GTFS (`getGTFS`) at startup, whose ids match the real-time feed.
- **Official figures** are also keyless — download the per-line rail CSVs from `njtransit.com/performance-data-download` into `./data/`.

Run the components, each in its own terminal:

```bash
NJT_DB_PATH=./data/njt.sqlite PORT=4055 npm run api       # API (reads ./data/njt.sqlite)
EXPO_PUBLIC_API_URL=http://localhost:4055 npm run web --workspace app   # web frontend
npm run pipeline                    # ingest worker (needs real NJT credentials — see .env.example)
```

For iOS / Android, use `npm run ios --workspace app` or `npm run android --workspace app` (or `npm run start --workspace app` and press `i` / `a`).

Until live collection runs, the independent measurement is simply empty — the app shows NJT's real published numbers and labels the independent metrics as still accruing rather than inventing data.

## Testing

```bash
npm test                      # Vitest: shared, db, pipeline, api, and the app's pure logic
npm test --workspace app      # jest-expo: React Native component tests
npm run typecheck             # strict tsc across shared/db/pipeline/api
npm run typecheck --workspace app
```

## More

- **Architecture, conventions, and where to add things:** [CLAUDE.md](CLAUDE.md) — read before editing.
- **Deployment:** [DEPLOY.md](DEPLOY.md) — pipeline + API on one Fly.io container sharing a SQLite volume; Expo web exports static to Cloudflare Pages.
- **Product spec:** [PRD.md](PRD.md). **Design system:** [DESIGN.md](DESIGN.md).
- **Credentials:** read from the environment only (see [`.env.example`](.env.example)); register at `developer.njtransit.com` (GTFS + GTFS-RT) and `datasource.njtransit.com` (XML train-control API). The pipeline respects NJT's request budgets and degrades gracefully under pressure.
- **Compliance:** NJT's terms disallow proxying the raw feed. The dashboard shows the disclaimer on every screen, never displays NJT's logo, and publishes pipeline uptime and known data gaps.