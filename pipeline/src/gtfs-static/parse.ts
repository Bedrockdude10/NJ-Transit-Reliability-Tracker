import type {
  GtfsRouteAliasRecord,
  GtfsRouteRecord,
  GtfsStopRecord,
  GtfsStopTimeRecord,
  GtfsTripRecord,
} from "@njt/db";
import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "../csv";
import { mapRailRoutes } from "./route-mapping";

export interface GtfsStaticData {
  routes: GtfsRouteRecord[];
  /** Source route_id → canonical route_id, so the RT feed's ids stay resolvable. */
  routeAliases: GtfsRouteAliasRecord[];
  stops: GtfsStopRecord[];
  trips: GtfsTripRecord[];
  stopTimes: GtfsStopTimeRecord[];
}

/** Unzip a GTFS static archive into `{ "routes.txt": contents, ... }`. */
export function unzipGtfs(zip: Uint8Array): Record<string, string> {
  const files = unzipSync(zip);
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) out[name] = strFromU8(bytes);
  return out;
}

/**
 * Parse GTFS static text files into catalog records: rail routes mapped to the
 * canonical catalog lines (so real-time trip/route ids resolve to the same
 * lines as the official metrics), and the trips/stops/stop_times they use.
 */
export function parseGtfsStatic(files: Record<string, string>): GtfsStaticData {
  const rawRoutes = files["routes.txt"] ? parseCsv(files["routes.txt"]) : [];
  const { canonicalRoutes, realToCanonical } = mapRailRoutes(rawRoutes);
  const routes: GtfsRouteRecord[] = [...canonicalRoutes.values()];
  const routeAliases: GtfsRouteAliasRecord[] = [...realToCanonical].map(([sourceRouteId, canonicalRouteId]) => ({
    sourceRouteId,
    canonicalRouteId,
  }));

  const rawTrips = files["trips.txt"] ? parseCsv(files["trips.txt"]) : [];
  const trips: GtfsTripRecord[] = [];
  for (const t of rawTrips) {
    const canonical = realToCanonical.get(t.route_id ?? "");
    if (!canonical) continue;
    trips.push({
      tripId: t.trip_id ?? "",
      routeId: canonical,
      serviceId: t.service_id || null,
      directionId: t.direction_id === "" || t.direction_id === undefined ? null : Number(t.direction_id),
      tripHeadsign: t.trip_headsign || null,
    });
  }
  const railTripIds = new Set(trips.map((t) => t.tripId));

  const rawStopTimes = files["stop_times.txt"] ? parseCsv(files["stop_times.txt"]) : [];
  const usedStopIds = new Set<string>();
  const stopTimes: GtfsStopTimeRecord[] = rawStopTimes
    .filter((st) => railTripIds.has(st.trip_id ?? ""))
    .map((st) => {
      usedStopIds.add(st.stop_id ?? "");
      return {
        tripId: st.trip_id ?? "",
        stopId: st.stop_id ?? "",
        stopSequence: Number(st.stop_sequence ?? 0),
        arrivalTime: st.arrival_time || null,
        departureTime: st.departure_time || null,
      };
    });

  const rawStops = files["stops.txt"] ? parseCsv(files["stops.txt"]) : [];
  const stops: GtfsStopRecord[] = rawStops
    .filter((s) => usedStopIds.size === 0 || usedStopIds.has(s.stop_id ?? ""))
    .map((s) => ({
      stopId: s.stop_id ?? "",
      stopName: s.stop_name ?? "",
      stopLat: s.stop_lat ? Number(s.stop_lat) : null,
      stopLon: s.stop_lon ? Number(s.stop_lon) : null,
    }));

  return { routes, routeAliases, stops, trips, stopTimes };
}
