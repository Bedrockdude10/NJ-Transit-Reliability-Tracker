# Server image: the pipeline + API (which share one SQLite file on a volume).
# The Expo app is NOT included here — it ships as static files to a CDN.
# Every process is esbuild-bundled to plain JS at build time (see below) — on a
# 512 MB machine the tsx runtime's footprint is the binding constraint.
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app

# Litestream, for continuous replication of the SQLite file to object storage.
# Pinned: this is the process guarding the only copy of the raw archive, and an
# unpinned backup tool silently changing behaviour is the last thing we want.
# Installed via the release .deb (amd64 — Fly's shared-cpu-1x), checksum-verified
# against the release's own checksums.txt.
ARG LITESTREAM_VERSION=0.5.16
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.deb /tmp/litestream.deb
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/checksums.txt /tmp/checksums.txt
RUN cd /tmp \
  && grep "litestream-${LITESTREAM_VERSION}-linux-x86_64.deb" checksums.txt | sed "s|litestream-${LITESTREAM_VERSION}-linux-x86_64.deb|litestream.deb|" | sha256sum -c - \
  && dpkg -i /tmp/litestream.deb \
  && rm -f /tmp/litestream.deb /tmp/checksums.txt \
  && litestream version

# Install dependencies for the SERVER workspaces only. We rewrite the
# "workspaces" list so npm never resolves the heavy Expo `app` package, keeping
# the image lean. --include=dev because esbuild (a dev dependency) builds the
# bundles below.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY db/package.json ./db/
COPY pipeline/package.json ./pipeline/
COPY api/package.json ./api/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['shared','db','pipeline','api'];fs.writeFileSync('package.json',JSON.stringify(p));" \
  && npm install --include=dev --no-audit --no-fund

# Source (esbuild bundles it below).
COPY tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY db ./db
COPY pipeline ./pipeline
COPY api ./api
COPY deploy ./deploy
# The data contract. Needed at build time — the events export embeds the manifest
# it was built against — and it describes every object this container writes.
COPY contract ./contract

# Precompile every process to plain JavaScript.
#
# 512 MB nominal is ~469 MB usable, and `npm run <name>` spends ~137 MB of it
# per child on nothing: an npm wrapper (~66 MB), a tsx launcher (~55 MB) and
# tsx's esbuild service (~16 MB), all to compile source that cannot change
# after the image is built. Across the API and the pipeline that is ~274 MB —
# so when an hourly job spawned there was too little left, the OOM killer took
# it, then the pipeline, and eventually the machine (2026-08-22).
#
# `dist/<name>.mjs` is the name `deploy/start.mjs` looks for; the CLIs keep
# their own names because the supervisor invokes them by path.
RUN node_modules/.bin/esbuild api/src/main.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/api.mjs \
  && node_modules/.bin/esbuild pipeline/src/main.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/pipeline.mjs \
  && node_modules/.bin/esbuild pipeline/src/archive/copy-cli.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/archive-copy.mjs \
  && node_modules/.bin/esbuild pipeline/src/archive/export-cli.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/events-export.mjs \
  && node_modules/.bin/esbuild pipeline/src/predictions/import-cli.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/predictions-import.mjs

# TLS roots for the S3 client. The base image is slim and ships none, and an
# upload to R2 fails at handshake without them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NJT_DB_PATH=/data/njt.sqlite
ENV PORT=4000
EXPOSE 4000

# Supervisor runs the API always, the pipeline once GTFS-RT is configured, and
# Litestream once a replication bucket is configured.
CMD ["node", "deploy/start.mjs"]
