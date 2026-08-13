import { createHash } from "node:crypto";
import type { Repositories } from "@njt/db";
import { parseGtfsStatic, unzipGtfs } from "./parse";

export interface LoadResult {
  versionId: string;
  /** True when this archive matched an already-ingested version (no-op). */
  unchanged: boolean;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ingest a GTFS static zip: dedup by checksum, supersede the current version,
 * and store the version, raw files, and parsed catalog. Returns the version id.
 */
export function loadGtfsStatic(repos: Repositories, zip: Uint8Array, now: number = Date.now()): LoadResult {
  const checksum = sha256(zip);
  const existing = repos.gtfs.findByChecksum(checksum);
  if (existing) return { versionId: existing.versionId, unchanged: true };

  const files = unzipGtfs(zip);
  const data = parseGtfsStatic(files);
  const versionId = `v-${checksum.slice(0, 12)}`;
  const effectiveFrom = Math.floor(now / 1000);

  const current = repos.gtfs.currentVersion();
  if (current && current.effectiveTo === null) repos.gtfs.supersede(current.versionId, effectiveFrom);

  repos.gtfs.insertVersion({ versionId, effectiveFrom, effectiveTo: null, checksum, ingestedAtMs: now });
  repos.gtfs.replaceRoutes(versionId, data.routes);
  repos.gtfs.replaceRouteAliases(versionId, data.routeAliases);
  repos.gtfs.replaceStops(versionId, data.stops);
  repos.gtfs.replaceTrips(versionId, data.trips);
  repos.gtfs.replaceStopTimes(versionId, data.stopTimes);

  const encoder = new TextEncoder();
  for (const [name, text] of Object.entries(files)) {
    repos.gtfs.storeFile(versionId, name, encoder.encode(text));
  }

  return { versionId, unchanged: false };
}
