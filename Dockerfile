# Server image: the pipeline + API (which share one SQLite file on a volume).
# The Expo app is NOT included here — it ships as static files to a CDN.
# We run TypeScript directly via tsx (no build step), which is fine at this scale.
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app

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

ENV NODE_ENV=production
ENV NJT_DB_PATH=/data/njt.sqlite
ENV PORT=4000
EXPOSE 4000

# Supervisor runs the API always, and the pipeline once GTFS-RT is configured.
CMD ["node", "deploy/start.mjs"]
