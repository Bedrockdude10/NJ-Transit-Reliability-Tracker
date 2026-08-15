# Server image: the pipeline + API (which share one SQLite file on a volume).
# The Expo app is NOT included here — it ships as static files to a CDN.
# We run TypeScript directly via tsx (no build step), which is fine at this scale.
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
# the image lean. --include=dev because we run via tsx (a dev dependency).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY db/package.json ./db/
COPY pipeline/package.json ./pipeline/
COPY api/package.json ./api/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['shared','db','pipeline','api'];fs.writeFileSync('package.json',JSON.stringify(p));" \
  && npm install --include=dev --no-audit --no-fund

# Source (tsx executes it directly).
COPY tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY db ./db
COPY pipeline ./pipeline
COPY api ./api
COPY deploy ./deploy

# Precompile the archive jobs to plain JavaScript.
#
# These run *while* the API and the pipeline are running, on a machine with
# ~173 MB to spare, so their footprint is the constraint. Under tsx the
# process is ~155 MB, ~25 MB of which is the runtime TypeScript compiler, plus
# another ~20 MB for the `npm run` wrapper — overhead that buys nothing here
# because the source never changes after the image is built.
RUN node_modules/.bin/esbuild pipeline/src/archive/copy-cli.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/archive-copy.mjs \
  && node_modules/.bin/esbuild pipeline/src/archive/export-cli.ts \
  --bundle --platform=node --format=esm --external:@aws-sdk/* \
  --outfile=dist/events-export.mjs

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
