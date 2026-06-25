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

/** GTFS `route_short_name` → light rail line (route_type 0). */
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

  // --- routes: rail → canonical catalog lines; light rail → its own lines ----
  const canonicalRoutes = new Map<string, GtfsRouteRecord>(); // canonical routeId -> record
  const realToCanonical = new Map<string, string>(); // GTFS route_id -> canonical routeId
  for (const row of parseCsv(read("routes.txt"))) {
    const short = row.route_short_name ?? "";
    if (row.route_type === "2") {
      const line = findLineById(SHORT_NAME_TO_LINE_ID[short] ?? "");
      if (!line) continue;
      realToCanonical.set(row.route_id!, line.defaultRouteId);
      if (!canonicalRoutes.has(line.defaultRouteId)) {
        canonicalRoutes.set(line.defaultRouteId, { routeId: line.defaultRouteId, lineName: line.name, color: row.route_color || null, mode: "rail" });
      }
    } else if (row.route_type === "0") {
      const lr = LIGHT_RAIL_BY_SHORT[short];
      if (!lr) continue;
      realToCanonical.set(row.route_id!, lr.routeId);
      if (!canonicalRoutes.has(lr.routeId)) {
        canonicalRoutes.set(lr.routeId, { routeId: lr.routeId, lineName: lr.lineName, color: row.route_color || null, mode: "light_rail" });
      }
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
