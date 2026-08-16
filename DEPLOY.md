# Deployment (Tier 1)

Two deployables:

```
┌── Fly.io machine + volume ─────────┐        ┌── Cloudflare Pages ──┐
│  pipeline + API (one container)    │◄─HTTPS─┤  Expo web (static)   │
│  └ /data/njt.sqlite on the volume  │  CORS  └──────────────────────┘
└─────────────────────────────────────┘
```

The pipeline and API share one SQLite file on a **persistent volume** (WAL = one writer + many readers). The volume is the only piece of state — keep it persistent and never scale the machine to zero (the pipeline must poll 24/7). The web app is static files on a CDN that call the API.

## What's already scaffolded (in this repo)

- `Dockerfile` — builds the server image (pipeline + API only; excludes the Expo app; runs via `tsx`).
- `deploy/start.mjs` — supervisor: runs the **API always**, and the **pipeline only when `NJT_RAIL_DATA_USERNAME` is set** (so you can launch before you have the GTFS-RT credentials).
- `fly.toml` — Fly app config with the volume mount, `/health` check, and always-on settings.
- `.dockerignore` — keeps the build context tiny (no `node_modules`, `data`, `app`).
- `app/public/_redirects` + `web.output: "single"` — SPA fallback so deep links (`/lines/NE`, `/stations/38293`) work on a static host.
- Scripts: `npm run bootstrap` (import GTFS + official) and `npm run start:server`. Measurement then accrues from the live feed — there is no synthetic data.

Everything below is the part **you** run — it needs accounts, the CLI, and secrets.

---

## 1. Push the repo to GitHub

```bash
git add -A && git commit -m "Add Tier 1 deployment scaffolding"
git push
```
(Remote is already `Bedrockdude10/NJ-Transit-Reliability-Tracker`.)

## 2. Server (pipeline + API) on Fly.io

Install + log in (one time):

```bash
brew install flyctl     # or: curl -L https://fly.io/install.sh | sh
fly auth login
```

Create the app + volume, then deploy (Fly builds the image **remotely** — small upload):

```bash
fly apps create njt-reliability-tracker          # pick a unique name; match fly.toml's `app`
fly volumes create njt_data --region ewr --size 10
fly deploy
```

At this point the **API is live** (pipeline is idle — no GTFS-RT key yet). Check it:

```bash
fly open /health
```

### Load the data onto the volume (one time)

The DB starts empty (the API auto-creates a ~4 KB placeholder at `/data/njt.sqlite` on first boot). You have two ways to populate it.

> **Two Fly footguns to know first:**
> - **`fly ssh console -C "…"` does not run a shell** — `>`, `|`, and `&&` are passed as literal arguments, not interpreted. For anything with a redirect or chain, open an interactive shell (`fly ssh console`, then type the commands), or wrap it: `fly ssh console -C "sh -c '…'"`.
> - On a **Fly trial**, machines auto-stop after 5 minutes (`Trial machine stopping…` in the logs). This app must run 24/7, so add a payment method (Dashboard → Billing) — this tiny VM sits within Fly's allowance.

**Option A — upload the prebuilt SQLite (recommended).** If you've already run `npm run bootstrap` locally, you have a complete `./data/njt.sqlite`. Ship that one file instead of rebuilding on the server. It gzips ~6:1, so it's the smallest transfer too:

```bash
# 1. compress locally (52 MB → ~9 MB); checkpoint first if a local API/pipeline is running
gzip -k -9 data/njt.sqlite

# 2. upload the .gz to the volume
fly ssh sftp shell
#   put data/njt.sqlite.gz /data/njt.sqlite.gz
#   quit

# 3. decompress IN AN INTERACTIVE SHELL (redirects don't work via -C)
fly ssh console
#   cd /data
#   gunzip -fc njt.sqlite.gz > njt.sqlite.new      # atomic swap avoids corrupting the file the API holds open
#   mv -f njt.sqlite.new njt.sqlite
#   rm -f njt.sqlite.gz njt.sqlite-wal njt.sqlite-shm   # drop the .gz + the empty-DB sidecars
#   ls -l                                          # expect njt.sqlite ~52 MB
#   exit

# 4. restart so the API reopens the real DB, then verify
fly apps restart njt-reliability-tracker
curl -s https://njt-reliability-tracker.fly.dev/lines | head -c 300   # real lines, not {"lines":[]}
```

Note `wget` isn't in the slim image — verify from your Mac with `curl` against the public URL (above), or on the box with `node -e "fetch('http://localhost:4000/lines').then(r=>r.text()).then(console.log)"`.

**Option B — build on the server** (no local DB, or you'd rather not transfer it). Keylessly fetch the sources and run the importer on the box so it never touches your connection:

```bash
fly ssh console
# inside the machine:
mkdir -p /data && cd /data
# GTFS static (keyless mirror) — replace with the current Mobility Database URL:
#   curl -L -o gtfs.zip "<mobility-database NJ Transit Rail .zip>" && unzip gtfs.zip -d mdb
# Official performance CSVs (keyless) — from njtransit.com/performance-data-download.
cd /app && NJT_GTFS_DIR=/data NJT_PERFORMANCE_DIR=/data npm run bootstrap
exit
```
(Or sftp your local `./data` — GTFS dir + CSVs, ~40 MB — then run `bootstrap`.) After either option, the dashboard shows real NJT official figures; the independent measurement accrues from the live feed once collection is on (§3). If a database was bootstrapped with the old synthetic seed, clear it once with `node deploy/purge-synthetic.mjs` (keeps the real network + official metrics).

**One-off purge — the pre-API seed.** Databases bootstrapped before live collection existed still hold the seed's fabricated trips, which inflate every measured figure and date the collection window from invented history. Preview, then apply:

```bash
npm run purge:seed
```

```bash
npm run purge:seed -- --apply
```

It deletes only rows carrying the seed's trip-id shape (`<LINE>-<direction>-<n>`; real GTFS-RT ids are numeric), recomputes each affected day from whatever genuinely remains, re-anchors `collection_start_date` to the first real observation, and drops gaps preceding the new window. Idempotent.

⚠ `deploy/purge-synthetic.mjs` is the *old* tool and clears `trip_stop_events` wholesale — correct when everything was synthetic, ruinous once real observations share the table. It now refuses to run if any real events exist; use `purge:seed` instead.

**Replaying the archive.** `raw_snapshots` holds every GTFS-Realtime payload so parsing can be re-run over history. After fixing a parser bug, re-derive the affected days instead of patching rows by hand:

```bash
npm run replay -- --from 2026-08-01 --to 2026-08-05
```

```bash
npm run replay -- --from 2026-08-01 --to 2026-08-05 --apply
```

Previews by default, reporting per day how many events it reproduced exactly, would change, would add, and how many stored events it could not account for. Each snapshot is decoded against the GTFS version that was effective when it was recorded, and readings are arbitrated by the same rule live ingest uses, so replaying unchanged code is a no-op. Stored events the archive cannot explain are counted but never deleted — snapshots may have been pruned.

Decoding is CPU-bound and the machine is small; expect a few minutes per day of history, and run it a few days at a time.

**One-off repair — line names.** Databases that collected before the RT parser could resolve the feed's *source* route ids hold events labelled with a raw `route_id` (a station showing service on a line called "10"). Run once per affected database:

```bash
npm run repair:line-names
```

It backfills `gtfs_route_aliases` from the archived `routes.txt`, repoints the affected events, and re-runs the aggregator for each touched service date. Idempotent — a second run reports nothing to repair.

## 3. Turn on live collection (when you have the NJT credentials)

Register at `developer.njtransit.com` (GTFS-RT) and optionally `datasource.njtransit.com` (XML). NJT's GTFS-RT Web API is **token-based**: the pipeline POSTs your username/password to `getToken` and caches the returned token in `pipeline_meta` (getToken is capped at 10/day, so it refreshes ~once/day — safe across restarts). Set the credentials as **secrets** (never commit these):

```bash
fly secrets set \
  NJT_RAIL_DATA_USERNAME=... \
  NJT_RAIL_DATA_PASSWORD=... \
  NJT_RAIL_DATA_BASE_URL=https://raildata.njtransit.com/api/GTFSRT \
  NJT_XML_API_KEY=... \
  NJT_XML_URL=...
```
`NJT_RAIL_DATA_BASE_URL` defaults to production; use `https://testraildata.njtransit.com/api/GTFSRT` to verify without spending the production getToken quota. Setting secrets restarts the machine; `start.mjs` now also launches the pipeline (because `NJT_RAIL_DATA_USERNAME` is set). Confirm on the **Pipeline Health** screen / `GET /health`.

## 4. Web app on Cloudflare (Workers static assets)

This repo deploys the web app as a **Cloudflare Worker serving static assets** (Cloudflare's current default; the classic Pages flow also works — see the note at the end). The Worker config lives in [`app/wrangler.jsonc`](app/wrangler.jsonc): it points at the Expo export (`./dist`) and uses `not_found_handling: "single-page-application"` for deep-link fallback (so **no `_redirects` file** — Cloudflare's asset engine rejects the `/* → /index.html` rule as an infinite loop).

In the Cloudflare dashboard → Workers & Pages → connect the GitHub repo, then set:

- **Build command:** `npm ci && npm run build:web --workspace app`
- **Deploy command:** `cd app && npx wrangler deploy`
  - The `cd app` matters: run at the repo root, `wrangler deploy` sees the npm `workspaces` field and aborts (*"detection logic has been run in the root of a workspace"*). Running inside `app/` also lets it find `wrangler.jsonc`.
- **`name` in `app/wrangler.jsonc` must equal your Worker/project name** (here `nj-transit-reliability-tracker`), or Cloudflare overrides it and opens a "fix config" PR.
- **Build variables** (Settings → Variables & Secrets, **Build** scope — *not* runtime):
  - `EXPO_PUBLIC_API_URL = https://njt-reliability-tracker.fly.dev` — **must be a build var.** Metro inlines `EXPO_PUBLIC_*` into the JS during `expo export`; a runtime Worker var does nothing for a static bundle. If the deployed site's network calls go to `localhost:4055`, this wasn't set as a build var — set it and redeploy.
  - `EXPO_PUBLIC_SITE_URL = https://<your-worker-or-custom-domain>` — for absolute Open Graph / Twitter URLs in `app/app/+html.tsx`. Optional; only affects social previews.

Drop a **`app/public/og-image.png`** (1200×630) in the repo — served at `/og-image.png`, referenced by the social card tags. Without it the link still works; it just previews without an image.

Cloudflare builds remotely (no bandwidth from you beyond the `git push`). CORS is already open on the API. The live Worker URL looks like `https://<name>.<account>.workers.dev`.

> **Classic Pages alternative:** create a Pages project (Workers & Pages → Pages → Connect to Git) with the same build command, **Build output directory `app/dist`**, and **no deploy command** (Pages publishes the directory directly). That path *does* use a `_redirects` SPA file — but since this repo deletes it in favor of the Worker config, re-add `app/public/_redirects` with `/*  /index.html  200` if you switch to Pages. (Netlify/Vercel: same build command/output/env.)

## Ongoing

- **Durability now:** enable Fly volume snapshots (`fly volumes` → daily snapshots), and see **Backups** below. The RT history is now worth protecting: it exists on one volume and no replay can re-derive it from anywhere else.
- **Updates:** `git push` → `fly deploy` (server) and Cloudflare auto-builds (web).
- **Keep it always-on:** don't change `auto_stop_machines`/`min_machines_running` in `fly.toml` — the pipeline must run continuously or you get permanent data gaps.

## Backups

`npm run snapshot` writes a verified, compressed copy of the live database:

```bash
fly ssh console -C "npm run snapshot -- --keep 7"
```

It uses `VACUUM INTO`, not a file copy — the database is written to continuously,
so a plain copy captures a torn mid-transaction state. Under WAL this takes a
read transaction and does **not** block the pipeline's polling, so it is safe to
run against production. It refuses to start if the volume lacks room, since
filling the volume would take the live database down with it, and it runs
`integrity_check` on the copy before keeping it — an unverified backup is a guess.

Measured on a 385 MB database: ~14s, compressing to **11%** of the original (the
raw protobuf blobs compress hard). Extrapolating to production's ~3 GB: roughly
2 minutes and ~320 MB per snapshot.

Restore:

```bash
npm run snapshot -- --restore njt-20260814T152502Z.sqlite.gz --to ./restored.sqlite
```

### Getting it off the volume

**A snapshot on its own is a restore point, not a backup** — it sits beside the
database it protects, so it survives a bad migration but not the loss of the
volume, which is the risk that matters.

Litestream is wired in for that: it tails the WAL to object storage, so the
replica is seconds behind rather than a day. It runs as a third supervised child
of `deploy/start.mjs`, which is not just convenient — a Fly volume attaches to
exactly one machine, so nothing outside this container can read the database and
a scheduled backup machine is not an option.

It stays switched off until configured, so deploying without the secrets below
changes nothing (`replication disabled` in the logs).

**What you need to provide:**

1. In the Cloudflare dashboard (the account already serving the web app):
   **R2 → Create bucket**, e.g. `njt-backups`.
2. **R2 → Manage API Tokens → Create** with Object Read & Write. It gives an
   **Access Key ID** and a **Secret Access Key**. R2 is S3-*compatible*; no AWS
   account is involved.
3. Note your **Account ID** from the R2 overview page — the endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Then:

**Deploy first, then set the secrets.** Setting them restarts the machine on the
image it already has, and if that image predates Litestream the supervisor finds
no binary. It degrades loudly rather than crashing — see `hasLitestream()` — but
you get a running site with no replication and a warning you have to notice.

```bash
fly deploy
```

```bash
fly secrets set \
  NJT_R2_BUCKET=njt-archive \
  NJT_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  NJT_R2_ACCESS_KEY_ID=<access key id> \
  NJT_R2_SECRET_ACCESS_KEY=<secret access key>
```

The same four variables drive both replication and `npm run export:events`.
DuckDB's S3 client wants a bare host where Litestream wants a scheme, so the
exporter strips it — one value to paste, not two spellings of it.

Confirm it took:

```bash
fly logs | grep litestream          # expect: replicating to  type=s3
fly ssh console -C "litestream status -config deploy/litestream.yml"
fly ssh console -C "litestream ltx list -config deploy/litestream.yml /data/njt.sqlite"
```

**Recovery is automatic.** On boot, if the volume has no database, the supervisor
runs `litestream restore` before anything opens it — deliberately, because
otherwise the API migrates a blank file and starts serving zeroes over the top of
recoverable history. A first deploy with nothing to restore logs and continues.

To restore by hand:

```bash
fly ssh console -C "litestream restore -config deploy/litestream.yml -o /data/recovered.sqlite /data/njt.sqlite"
```

Cost: writes land roughly every 30s, so about 86k uploads/month against R2's
1M free Class A operations, with a gzipped snapshot and WAL well inside the 10 GB
allowance and no egress fees. This workload should sit in the free tier.

**If you would rather not use R2:** Litestream cannot target Google Drive, so
that route means `npm run snapshot` on a schedule plus an rclone upload — and
because of the single-volume-attach constraint, that schedule has to run inside
this container too. It is more work than the above, not less.

## Publishing events for the modelling repo

`npm run export:events` writes derived events to object storage as **gzipped JSON
Lines**, one hive-partitioned object per service date, for
[njt-delay-modeling](https://github.com/Bedrockdude10/njt-delay-modeling) to read.
Re-running a date replaces its object, so it is safe to schedule and safe to
rerun after a backfill.

Not Parquet: writing it needed DuckDB, which costs ~211 MB resident before reading
a row and cannot run on this machine. The consumer converts on its own hardware;
`contract/v1` describes records, not an encoding.

The records are the `TripStopEvent` domain objects the contract is generated from,
and `archive-export.test.ts` round-trips real rows through SQLite and asserts the
JSON keys equal the contract's — a field added to the contract and forgotten in the
export fails the build rather than being silently absent from every file.

```bash
fly ssh console -C "npm run export:events -- --from 2026-08-01"
```

Uses the same `NJT_R2_*` secrets as replication.

Verified end to end against MinIO locally: 36 service dates, 20,736 rows written
and read back by the Python repo with every row passing strict contract
validation.

## Draining the raw archive

`raw_snapshots` is the bulk of the database and grows **130 MB/day**. That fills
the volume, makes every backup expensive, and made Litestream's first snapshot
heavy enough to starve the API. `npm run archive:copy` moves it to object storage,
and the supervisor runs it hourly once `NJT_ARCHIVE_COPY_ENABLED=true`:

```bash
fly ssh console -C "npm run archive:copy -- --older-than-hours 2"
```

Whole closed UTC hours only (a day of blobs will not fit in memory on a 512 MB
box), each read back and compared by content digest, and deleted only once it is
verifiably stored. Reruns are free.

**It does not shrink the file, on purpose.** Deleting frees pages inside the
database for reuse, so the file stops growing at its current size — which is what
the volume ceiling actually requires. Reclaiming the disk is a separate,
deliberate step; see below.

Uses the same `NJT_R2_*` secrets as replication.

## Reclaiming the disk (`npm run compact`)

The drain leaves a file that is mostly hole: 3.81 GB holding 599 MB of live data.
That is not free — every backup copies all of it, and it is what made Litestream's
first snapshot heavy enough to cause a twelve-minute outage. `npm run compact`
gives the space back.

`VACUUM INTO`, not `VACUUM`. Plain `VACUUM` rewrites the live database in place
under an exclusive lock, which is the same rewrite-everything load that caused the
outage. `VACUUM INTO` writes a fresh compact database elsewhere while readers
carry on, and leaves the original untouched until something has checked the result.

Start with the preview, which changes nothing:

```bash
fly ssh console -C "npm run compact"
```

```
On disk         3809 MB
Live data        285 MB
Reclaimable     3524 MB
Volume free     3672 MB (needs 447 MB)
Raw snapshots     667 still to drain
```

**"Raw snapshots still to drain" does not reach zero, and is not meant to.** The
drain deliberately keeps the last two hours in SQLite (`COPY_RETAIN_HOURS`), so the
steady-state floor is ~500–700 rows — about 5 MB, under 2% of live data. What the
number is really reporting is whether there is a *backlog*: compare the oldest
`raw_snapshots.fetched_at_ms` against that two-hour window. Inside it, the drain is
current and `--max-raw-snapshots 1000` is the right call. Well outside it, the
hourly copy is behind and should be caught up first:

```bash
fly ssh console -C "npm run archive:copy -- --older-than-hours 2"
```

Pass `--older-than-hours` explicitly. The CLI defaults to 48 where the supervisor
passes 2, so a bare `npm run archive:copy` cheerfully reports `nothing eligible to
copy` with twelve hours of backlog sitting in the file.

### Why this cannot run against a live pipeline

`VACUUM INTO` reads inside a transaction, so the copy is the database as of the
instant it began. The pipeline writes continuously. Swapping in a copy taken five
minutes ago **silently discards five minutes of ingest** — the result is a
perfectly valid database that simply lacks them, and NJT serves no history to
re-fetch them from.

So `--apply` pauses ingest first, by creating the maintenance flag the supervisor
watches (`deploy/maintenance.mjs`). The supervisor stops the pipeline and — unlike
a plain `kill`, which it would treat as a crash and restart within seconds — does
not bring it back until the flag clears. The API keeps running throughout; it only
reads.

Stopping it means signalling the whole **process group**, not the supervisor's
direct child. The first production run of this found out why: the child is `npm`,
npm does not forward SIGTERM to the `sh -c tsx …` beneath it, and the real pipeline
was left reparented to init — still polling NJT, still writing — while the
supervisor watched npm exit, reported ingest stopped, and started a second one.
Children are now spawned `detached` and stopped with a negative pid
(`stopProcessTree`). If you ever need to check by hand, the image has no `ps`:

```bash
fly ssh console -C "node -e 'const f=require(\"fs\");console.log(f.readdirSync(\"/proc\").filter(p=>/^[0-9]+$/.test(p)).map(p=>{try{return f.readFileSync(\"/proc/\"+p+\"/cmdline\",\"utf8\").replace(/\\0/g,\" \")}catch{return \"\"}}).filter(c=>/pipeline\\/src\\/main/.test(c)).length+\" pipeline processes\")'"
```

Then it refuses to swap unless it can *prove* nothing wrote while it worked, rather
than trusting that the pause took: `PRAGMA data_version` is sampled before the copy
and again after, and a change means the copy is already stale.

### Running it

```bash
fly ssh console -C "npm run compact -- --apply"
```

It will refuse, leaving the database untouched, if the volume lacks room, if raw
snapshots are still draining (those pages are about to be freed anyway — pass
`--max-raw-snapshots N` to override), if anything is still writing, if the copy
fails `integrity_check`, or if any table's row count differs between the original
and the copy.

Then, in order:

1. **Restart the API.** Its open handle still points at the file that was moved
   aside, so until it restarts it serves the pre-compaction database.
   `fly apps restart njt-reliability-tracker`.
2. Check `/health`, `/health/live`, and that the site renders.
3. Only then remove the old file: `rm /data/njt.sqlite.pre-compact*`.

The previous database is kept as `/data/njt.sqlite.pre-compact` precisely so step 3
is a decision rather than a consequence. It also means the volume holds both until
you delete it.

### Order of operations

Compaction and replication interact, and getting this order wrong is what caused
the last outage. Enable them in this order:

1. Set the four `NJT_R2_*` secrets. These give `archive:copy` access to object
   storage and **do not** start replication on their own — credentials being
   present is deliberately not consent to run the daemon.
2. **Drain**, until `raw_snapshots` is near zero and the file is no longer growing.
3. **Compact**, so the file is ~600 MB rather than 3.8 GB.
4. **Then** `fly secrets set NJT_REPLICATION_ENABLED=true`.
5. **Verify the restore** (below). This is not optional: steps 1-4 prove nothing.

Enabling replication before step 3 is what starved the API into an outage, with
Litestream trying to snapshot 3.8 GB on a 512 MB box.

## Proving the restore (`npm run verify:restore`)

A backup nobody has restored is a hypothesis. `litestream replicate` logs happily
whether or not the result can be restored, and the moment anyone finds out is the
moment they need it — with the volume already gone.

```bash
fly ssh console -C "npm run verify:restore"
```

It restores the replica to a scratch path beside the live database, runs
`integrity_check`, compares row counts table by table against the live database,
and deletes the scratch copy. It never writes to the live file, and it is safe to
run while the pipeline is polling.

```
Restored 598 MB, integrity ok.
  trip_stop_events         1284402/1284402
  otp_daily                     412/412
  predictions                     0/0
The off-site copy is restorable.
```

A small shortfall is expected — Litestream ships the WAL continuously but not
synchronously, so a table being written to is legitimately a few rows behind. The
default tolerance is 1%; `--tolerance 0.05` loosens it. A table that is *empty* in
the replica and full in the original is not lag, and fails regardless.

It exits non-zero on failure, so it is worth running on a schedule rather than
once: replication that worked the day it was switched on can stop silently —
expired credentials, a deleted bucket, a machine redeployed onto an image without
the binary — and the log line reads the same either way.

## Uptime monitoring

Both of this project's outages were noticed because a human happened to be looking.

Two checks, because they fail independently:

| Check | What it catches |
| --- | --- |
| `/health` | The site is unreachable at all. |
| `/health/live` | Ingest has stalled while the API stays up. Answers **503** once TripUpdates has been silent for `NJT_NO_TRIP_UPDATES_ALERT_MS` (1h). |

The second one matters more than it looks. The supervisor deliberately keeps the
API alive through a pipeline crash — that is what stopped two crashes from becoming
total outages — so the site can serve a dashboard that has quietly stopped
advancing while an ordinary uptime check stays green. An ingest gap is permanent.

The monitors live in `deploy/monitors.json` rather than in a dashboard, and are
applied with:

```bash
BETTERSTACK_API_TOKEN=… NJT_PUBLIC_API_URL=https://njt-reliability-tracker.fly.dev \
  npm run monitors:sync -- --dry-run     # then without --dry-run to apply
```

**What you need to provide:** a [Better Stack](https://betterstack.com/uptime)
account (the free tier covers both checks at these frequencies), then
Settings → API tokens → create one. Add the alert channel — email, Slack — in
their UI; the sync sets `email: true` and does not manage routing.

Matching is by URL, so re-running updates rather than duplicates. Monitors the
file does not describe are reported and **left alone** — someone else's check
disappearing because this file did not mention it is worse than a stale one.

Verify it actually alerts, rather than assuming: stop the machine
(`fly machine stop`) and confirm the alert arrives before starting it again.

## VPS alternative (cheapest, most metered-friendly)

On any small box (Hetzner, a free Oracle ARM VM, etc.) with Docker:

```bash
git clone https://github.com/Bedrockdude10/NJ-Transit-Reliability-Tracker && cd NJ-Transit-Reliability-Tracker
docker build -t njt .
docker run -d --restart=always -p 4000:4000 \
  -v /srv/njt-data:/data --env-file .env njt
```
Put **Caddy** in front for automatic HTTPS, point a domain at it, and set `EXPO_PUBLIC_API_URL` to that domain for the Cloudflare Pages build. Deploy updates with `git pull && docker build && docker run` — only a tiny `git pull` uses your connection.
