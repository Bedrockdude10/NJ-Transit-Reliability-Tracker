import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  GtfsStopRecord,
  GtfsStopTimeRecord,
  GtfsTripRecord,
  Repositories,
} from "@njt/db";
import { parseCsv } from "../csv";
import { mapRailRoutes } from "../gtfs-static/route-mapping";

/**
 * GTFS static rail feed from an unzipped directory. Light rail (route_type 0) is a
 * separate catalog keyed by short name, not one of the canonical lines.
 */

const LIGHT_RAIL_BY_SHORT: Record<string, { routeId: string; lineName: string }> = {
  HBLR: { routeId: "HBLR", lineName: "Hudson-Bergen Light Rail" },
  NLR: { routeId: "NLR", lineName: "Newark Light Rail" },
  RVLN: { routeId: "RVLN", lineName: "River Line" },
};

export interface GtfsImportResult {
  versionId: string;
  routes: number;
  stops: number;
  trips: number;
  stopTimes: number;
}

/** `dir` itself, or the newest `mdb-*` child of it. */
export function findGtfsDir(dir: string): string | null {
  if (existsSync(join(dir, "stops.txt")) && existsSync(join(dir, "routes.txt"))) return dir;
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, "stops.txt")) && existsSync(join(p, "routes.txt")))
    .sort();
  return candidates.at(-1) ?? null;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A GTFS field the spec marks required: a missing value is a malformed feed, not empty input. */
function required(row: Record<string, string>, field: string, file: string): string {
  const value = row[field];
  if (value === undefined || value === "") {
    throw new Error(`${file}: required field ${field} is missing or empty`);
  }
  return value;
}

export function importGtfsStatic(repos: Repositories, gtfsDir: string): GtfsImportResult {
  const read = (name: string) => readFileSync(join(gtfsDir, name), "utf8");

  const rawRoutes = parseCsv(read("routes.txt"));
  const { canonicalRoutes, realToCanonical } = mapRailRoutes(rawRoutes);
  for (const row of rawRoutes) {
    if (row.route_type !== "0") continue;
    const lr = LIGHT_RAIL_BY_SHORT[row.route_short_name ?? ""];
    if (!lr) continue;
    realToCanonical.set(required(row, "route_id", "routes.txt"), lr.routeId);
    if (!canonicalRoutes.has(lr.routeId)) {
      canonicalRoutes.set(lr.routeId, { routeId: lr.routeId, lineName: lr.lineName, color: row.route_color || null, mode: "light_rail" });
    }
  }

  const stops: GtfsStopRecord[] = parseCsv(read("stops.txt")).map((row) => ({
    stopId: required(row, "stop_id", "stops.txt"),
    stopName: row.stop_name ?? required(row, "stop_id", "stops.txt"),
    stopLat: num(row.stop_lat),
    stopLon: num(row.stop_lon),
  }));

  const railTripIds = new Set<string>();
  const trips: GtfsTripRecord[] = [];
  for (const row of parseCsv(read("trips.txt"))) {
    const canonical = realToCanonical.get(row.route_id ?? "");
    if (!canonical) continue;
    railTripIds.add(required(row, "trip_id", "trips.txt"));
    trips.push({
      tripId: required(row, "trip_id", "trips.txt"),
      routeId: canonical,
      serviceId: row.service_id ?? null,
      directionId: num(row.direction_id),
      tripHeadsign: row.trip_headsign ?? null,
    });
  }

  const stopTimes: GtfsStopTimeRecord[] = [];
  for (const row of parseCsv(read("stop_times.txt"))) {
    if (!railTripIds.has(row.trip_id ?? "")) continue;
    stopTimes.push({
      tripId: required(row, "trip_id", "stop_times.txt"),
      stopId: required(row, "stop_id", "stop_times.txt"),
      stopSequence: Number(row.stop_sequence),
      arrivalTime: row.arrival_time || null,
      departureTime: row.departure_time || null,
    });
  }

  const checksum = createHash("sha256").update(read("trips.txt")).digest("hex").slice(0, 16);
  const versionId = `gtfs-${checksum}`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  repos.gtfs.insertVersion({ versionId, effectiveFrom: nowSeconds, effectiveTo: null, checksum, ingestedAtMs: Date.now() });
  repos.gtfs.replaceRoutes(versionId, [...canonicalRoutes.values()]);
  repos.gtfs.replaceRouteAliases(
    versionId,
    [...realToCanonical].map(([sourceRouteId, canonicalRouteId]) => ({ sourceRouteId, canonicalRouteId })),
  );
  repos.gtfs.replaceStops(versionId, stops);
  repos.gtfs.replaceTrips(versionId, trips);
  repos.gtfs.replaceStopTimes(versionId, stopTimes);

  return { versionId, routes: canonicalRoutes.size, stops: stops.length, trips: trips.length, stopTimes: stopTimes.length };
}
