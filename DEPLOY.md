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

```bash
fly secrets set \
  LITESTREAM_BUCKET=njt-backups \
  LITESTREAM_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  LITESTREAM_ACCESS_KEY_ID=<access key id> \
  LITESTREAM_SECRET_ACCESS_KEY=<secret access key>

fly deploy
```

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

## VPS alternative (cheapest, most metered-friendly)

On any small box (Hetzner, a free Oracle ARM VM, etc.) with Docker:

```bash
git clone https://github.com/Bedrockdude10/NJ-Transit-Reliability-Tracker && cd NJ-Transit-Reliability-Tracker
docker build -t njt .
docker run -d --restart=always -p 4000:4000 \
  -v /srv/njt-data:/data --env-file .env njt
```
Put **Caddy** in front for automatic HTTPS, point a domain at it, and set `EXPO_PUBLIC_API_URL` to that domain for the Cloudflare Pages build. Deploy updates with `git pull && docker build && docker run` — only a tiny `git pull` uses your connection.
