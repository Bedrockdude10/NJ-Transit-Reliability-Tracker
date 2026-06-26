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
- `deploy/start.mjs` — supervisor: runs the **API always**, and the **pipeline only when `NJT_TRIP_UPDATES_URL` is set** (so you can launch before you have the GTFS-RT key).
- `fly.toml` — Fly app config with the volume mount, `/health` check, and always-on settings.
- `.dockerignore` — keeps the build context tiny (no `node_modules`, `data`, `app`).
- `app/public/_redirects` + `web.output: "single"` — SPA fallback so deep links (`/lines/NE`, `/stations/38293`) work on a static host.
- Scripts: `npm run bootstrap` (import GTFS + official + seed) and `npm run start:server`.

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
(Or sftp your local `./data` — GTFS dir + CSVs, ~40 MB — then run `bootstrap`.) After either option, the dashboard shows real NJT official figures + synthetic independent data.

## 3. Turn on live collection (when you have the NJT key)

Register at `developer.njtransit.com` (GTFS-RT) and `datasource.njtransit.com` (XML), then set them as **secrets** (never commit these):

```bash
fly secrets set \
  NJT_GTFS_RT_API_KEY=... \
  NJT_TRIP_UPDATES_URL=... \
  NJT_VEHICLE_POSITIONS_URL=... \
  NJT_SERVICE_ALERTS_URL=... \
  NJT_XML_API_KEY=... \
  NJT_XML_URL=...
```
Setting secrets restarts the machine; `start.mjs` now also launches the pipeline (because `NJT_TRIP_UPDATES_URL` is set). Confirm on the **Pipeline Health** screen / `GET /health`.

## 4. Web app on Cloudflare Pages

In the Cloudflare dashboard → Pages → connect the GitHub repo, then:

- **Build command:** `npm ci && npm run build:web --workspace app`
- **Build output directory:** `app/dist`
- **Environment variables:**
  - `EXPO_PUBLIC_API_URL = https://njt-reliability-tracker.fly.dev` (your Fly URL)
  - `EXPO_PUBLIC_SITE_URL = https://<your-pages-domain>` (the web origin — used to build absolute Open Graph / Twitter card URLs in `app/app/+html.tsx`; if unset, social previews fall back to relative URLs and may not render in every client)

Drop a **`app/public/og-image.png`** (1200×630) in the repo — it's served at `/og-image.png` and referenced by the social card tags. Without it the link still works; it just previews without an image.

Cloudflare builds remotely (no bandwidth from you beyond the `git push`). The `_redirects` file ships in the output, so deep links resolve. CORS is already open on the API.

(Netlify works identically; Vercel too — same build command/output/env.)

## Ongoing

- **Durability now:** enable Fly volume snapshots (`fly volumes` → daily snapshots). That's the launch-time safety net; add Litestream → R2 once you've collected RT history worth protecting.
- **Updates:** `git push` → `fly deploy` (server) and Cloudflare auto-builds (web).
- **Keep it always-on:** don't change `auto_stop_machines`/`min_machines_running` in `fly.toml` — the pipeline must run continuously or you get permanent data gaps.

## VPS alternative (cheapest, most metered-friendly)

On any small box (Hetzner, a free Oracle ARM VM, etc.) with Docker:

```bash
git clone https://github.com/Bedrockdude10/NJ-Transit-Reliability-Tracker && cd NJ-Transit-Reliability-Tracker
docker build -t njt .
docker run -d --restart=always -p 4000:4000 \
  -v /srv/njt-data:/data --env-file .env njt
```
Put **Caddy** in front for automatic HTTPS, point a domain at it, and set `EXPO_PUBLIC_API_URL` to that domain for the Cloudflare Pages build. Deploy updates with `git pull && docker build && docker run` — only a tiny `git pull` uses your connection.
