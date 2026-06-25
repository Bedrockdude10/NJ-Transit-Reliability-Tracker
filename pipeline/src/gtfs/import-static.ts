import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  GtfsRouteRecord,
  GtfsStopRecord,
  GtfsStopTimeRecord,
  GtfsTripRecord,
  Repositories,
} from "@njt/db";
import { findLineById } from "@njt/shared";
import { parseCsv } from "../csv";

/**
 * Importer for NJ Transit's GTFS *static* rail feed (keyless — from the Mobility
 * Database mirror or developer.njtransit.com). It loads the real network into
 * the GTFS tables: routes (mapped to our canonical catalog lines, with NJT's
 * real colors), stops with coordinates, trips, and stop_times. This becomes the
 * current GTFS version, so the whole app runs on the real network.
 *
 * GTFS `route_type` 2 = commuter rail (what we ingest); 0 = light rail (handled
 * separately via the performance CSVs). Several rail routes are variants of one
 * line (e.g. NJCL + NJCLL); we collapse them to a single canonical line.
 */

/** GTFS `route_short_name` → reference catalog line id. */
const SHORT_NAME_TO_LINE_ID: Record<string, string> = {
  ATLC: "atlantic-city",
  BNTN: "montclair-boonton",
  BNTNM: "montclair-boonton",
  MNBN: "main-bergen",
  MNBNP: "port-jervis",
  MNE: "morris-essex",
  MNEG: "gladstone",
  MRL: "meadowlands",
  NEC: "northeast-corridor",
  NJCL: "north-jersey-coast",
  NJCLL: "north-jersey-coast",
  PASC: "pascack-valley",
  PRIN: "princeton-shuttle",
  RARV: "raritan-valley",
};

const RAIL_ROUTE_TYPE = "2";

export interface GtfsImportResult {
  versionId: string;
  routes: number;
  stops: number;
  trips: number;
  stopTimes: number;
}

/** Locate a GTFS directory: `dir` itself, or the newest `mdb-*` child of it. */
export function findGtfsDir(dir: string): string | null {
  if (existsSync(join(dir, "stops.txt")) && existsSync(join(dir, "routes.txt"))) return dir;
  // Fall back to a child directory that looks like an unzipped feed.
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

export function importGtfsStatic(repos: Repositories, gtfsDir: string): GtfsImportResult {
  const read = (name: string) => readFileSync(join(gtfsDir, name), "utf8");

  // --- routes: map rail routes to canonical catalog lines -------------------
  const canonicalRoutes = new Map<string, GtfsRouteRecord>(); // catalog routeId -> record
  const realToCanonical = new Map<string, string>(); // GTFS route_id -> catalog routeId
  for (const row of parseCsv(read("routes.txt"))) {
    if (row.route_type !== RAIL_ROUTE_TYPE) continue;
    const lineId = SHORT_NAME_TO_LINE_ID[row.route_short_name ?? ""];
    const line = lineId ? findLineById(lineId) : undefined;
    if (!line) continue;
    realToCanonical.set(row.route_id!, line.defaultRouteId);
    if (!canonicalRoutes.has(line.defaultRouteId)) {
      canonicalRoutes.set(line.defaultRouteId, {
        routeId: line.defaultRouteId,
        lineName: line.name,
        color: row.route_color || null,
      });
    }
  }

  // --- stops (all, with coordinates) ----------------------------------------
  const stops: GtfsStopRecord[] = parseCsv(read("stops.txt")).map((row) => ({
    stopId: row.stop_id!,
    stopName: row.stop_name ?? row.stop_id!,
    stopLat: num(row.stop_lat),
    stopLon: num(row.stop_lon),
  }));

  // --- trips (rail only, route_id rewritten to canonical) -------------------
  const railTripIds = new Set<string>();
  const trips: GtfsTripRecord[] = [];
  for (const row of parseCsv(read("trips.txt"))) {
    const canonical = realToCanonical.get(row.route_id ?? "");
    if (!canonical) continue;
    railTripIds.add(row.trip_id!);
    trips.push({
      tripId: row.trip_id!,
      routeId: canonical,
      serviceId: row.service_id ?? null,
      directionId: num(row.direction_id),
      tripHeadsign: row.trip_headsign ?? null,
    });
  }

  // --- stop_times (rail trips only) -----------------------------------------
  const stopTimes: GtfsStopTimeRecord[] = [];
  for (const row of parseCsv(read("stop_times.txt"))) {
    if (!railTripIds.has(row.trip_id ?? "")) continue;
    stopTimes.push({
      tripId: row.trip_id!,
      stopId: row.stop_id!,
      stopSequence: Number(row.stop_sequence),
      arrivalTime: row.arrival_time || null,
      departureTime: row.departure_time || null,
    });
  }

  // --- persist as a new, current GTFS version -------------------------------
  const checksum = createHash("sha256").update(read("trips.txt")).digest("hex").slice(0, 16);
  const versionId = `gtfs-${checksum}`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  repos.gtfs.insertVersion({ versionId, effectiveFrom: nowSeconds, effectiveTo: null, checksum, ingestedAtMs: Date.now() });
  repos.gtfs.replaceRoutes(versionId, [...canonicalRoutes.values()]);
  repos.gtfs.replaceStops(versionId, stops);
  repos.gtfs.replaceTrips(versionId, trips);
  repos.gtfs.replaceStopTimes(versionId, stopTimes);

  return { versionId, routes: canonicalRoutes.size, stops: stops.length, trips: trips.length, stopTimes: stopTimes.length };
}
