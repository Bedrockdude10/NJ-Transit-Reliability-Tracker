import type { GtfsRouteRecord, GtfsStopRecord, GtfsStopTimeRecord, GtfsTripRecord } from "@njt/db";
import { strFromU8, unzipSync } from "fflate";
import { parseCsv } from "../csv";

export interface GtfsStaticData {
  routes: GtfsRouteRecord[];
  stops: GtfsStopRecord[];
  trips: GtfsTripRecord[];
  stopTimes: GtfsStopTimeRecord[];
}

/** GTFS `route_type` for rail. v1 is rail-only (buses are a non-goal). */
const RAIL_ROUTE_TYPE = "2";

/** Unzip a GTFS static archive into `{ "routes.txt": contents, ... }`. */
export function unzipGtfs(zip: Uint8Array): Record<string, string> {
  const files = unzipSync(zip);
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) out[name] = strFromU8(bytes);
  return out;
}

/**
 * Parse GTFS static text files into catalog records, filtered to rail routes
 * and the trips/stops/stop_times they reference.
 */
export function parseGtfsStatic(files: Record<string, string>): GtfsStaticData {
  const rawRoutes = files["routes.txt"] ? parseCsv(files["routes.txt"]) : [];
  const railRouteIds = new Set(
    rawRoutes.filter((r) => (r.route_type ?? "") === RAIL_ROUTE_TYPE).map((r) => r.route_id),
  );

  const routes: GtfsRouteRecord[] = rawRoutes
    .filter((r) => railRouteIds.has(r.route_id))
    .map((r) => ({
      routeId: r.route_id ?? "",
      lineName: r.route_long_name || r.route_short_name || r.route_id || "",
    }));

  const rawTrips = files["trips.txt"] ? parseCsv(files["trips.txt"]) : [];
  const trips: GtfsTripRecord[] = rawTrips
    .filter((t) => railRouteIds.has(t.route_id ?? ""))
    .map((t) => ({
      tripId: t.trip_id ?? "",
      routeId: t.route_id ?? "",
      serviceId: t.service_id || null,
      directionId: t.direction_id === "" || t.direction_id === undefined ? null : Number(t.direction_id),
      tripHeadsign: t.trip_headsign || null,
    }));
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

  return { routes, stops, trips, stopTimes };
}
