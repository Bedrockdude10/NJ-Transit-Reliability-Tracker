import type { Repositories } from "@njt/db";
import { RAIL_LINES, toLocalDateString, type TripStopEvent } from "@njt/shared";
import { recomputeServiceDate } from "../aggregator";

/**
 * Build a **local development** database so UI work can be seen without NJT
 * credentials. Writes fabricated data, so it is fenced three ways: it refuses a path
 * under `/data`, it refuses a database holding real observations, and every trip id
 * it mints uses the `<LINE>-<direction>-<n>` shape `npm run purge:seed` deletes.
 */

const LINES = RAIL_LINES.slice(0, 6);
const STOPS = [
  { stopId: "1", stopName: "Newark Penn", lat: 40.7346, lon: -74.1643 },
  { stopId: "2", stopName: "New York Penn", lat: 40.7506, lon: -73.9935 },
  { stopId: "3", stopName: "Secaucus Junction", lat: 40.7616, lon: -74.0757 },
  { stopId: "4", stopName: "Metropark", lat: 40.5687, lon: -74.3293 },
  { stopId: "5", stopName: "Princeton Junction", lat: 40.3186, lon: -74.6229 },
  { stopId: "6", stopName: "Hoboken", lat: 40.7348, lon: -74.0277 },
];

export interface DevFixtureResult {
  days: number;
  events: number;
  upcoming: number;
}

/** Deterministic pseudo-random in [0,1) so repeated runs look the same. */
function rand(seed: number): number {
  const x = Math.sin(seed) * 10_000;
  return x - Math.floor(x);
}

export function buildDevFixture(repos: Repositories, nowMs: number = Date.now(), days = 14): DevFixtureResult {
  const versionId = "dev-fixture";
  repos.gtfs.insertVersion({ versionId, effectiveFrom: 0, effectiveTo: null, checksum: versionId, ingestedAtMs: nowMs });
  repos.gtfs.replaceRoutes(
    versionId,
    LINES.map((l, i) => ({ routeId: l.defaultRouteId, lineName: l.name, color: ["DD3439", "00A1DE", "FFD411", "A4C9AA", "F68B1F", "6A5ACD"][i] ?? null, mode: "rail" as const })),
  );
  repos.gtfs.replaceStops(versionId, STOPS.map((s) => ({ stopId: s.stopId, stopName: s.stopName, stopLat: s.lat, stopLon: s.lon })));

  const trips: { tripId: string; routeId: string; directionId: number; tripHeadsign: string }[] = [];
  for (const line of LINES) {
    for (const dir of [0, 1]) {
      for (let n = 0; n < 8; n++) {
        trips.push({
          tripId: `${line.defaultRouteId}-${dir === 1 ? "inbound" : "outbound"}-${n}`,
          routeId: line.defaultRouteId,
          directionId: dir,
          tripHeadsign: dir === 1 ? "New York Penn" : line.name.replace(" Line", ""),
        });
      }
    }
  }
  repos.gtfs.replaceTrips(versionId, trips);
  repos.gtfs.replaceStopTimes(
    versionId,
    trips.flatMap((t) =>
      STOPS.map((s, i) => ({
        tripId: t.tripId,
        stopId: s.stopId,
        stopSequence: i + 1,
        arrivalTime: `0${6 + i}:00:00`,
        departureTime: `0${6 + i}:01:00`,
      })),
    ),
  );

  const nowSec = Math.floor(nowMs / 1000);
  let events = 0;
  let upcoming = 0;
  let seed = 1;

  // Historical days, so the aggregate-driven screens have something to draw.
  for (let d = days; d >= 1; d--) {
    const serviceDate = toLocalDateString(nowSec - d * 86_400);
    const batch: TripStopEvent[] = [];
    for (const t of trips) {
      for (const [i, s] of STOPS.entries()) {
        const r = rand(seed++);
        // Mostly punctual, with a long tail of lateness.
        const delay = r > 0.86 ? Math.round(120 + r * 1500) : Math.round((r - 0.4) * 120);
        const cancelled = r > 0.985;
        const scheduled = nowSec - d * 86_400 + (6 + i) * 3600;
        batch.push({
          tripId: t.tripId,
          routeId: t.routeId,
          lineName: LINES.find((l) => l.defaultRouteId === t.routeId)?.name ?? t.routeId,
          stopId: s.stopId,
          stopName: s.stopName,
          stopSequence: i + 1,
          direction: t.directionId === 1 ? "inbound" : "outbound",
          serviceDate,
          scheduledArrival: scheduled,
          scheduledDeparture: scheduled + 60,
          observedArrival: cancelled ? null : scheduled + delay,
          delaySeconds: cancelled ? null : delay,
          stopSkipped: false,
          tripCancelled: cancelled,
          gtfsStaticVersion: versionId,
          ingestedAtMs: nowMs,
        });
      }
    }
    repos.events.recordMany(batch);
    events += batch.length;
    recomputeServiceDate(repos, serviceDate);
  }

  // Today, including forward predictions so the live board has content.
  const today = toLocalDateString(nowSec);
  const live: TripStopEvent[] = [];
  for (const [ti, t] of trips.entries()) {
    for (const [i, s] of STOPS.entries()) {
      const r = rand(seed++);
      // Mostly ahead, with a couple just gone so the "departed" row is visible.
      const dueIn = (ti % 12) * 420 + i * 180 - 240;
      const scheduled = nowSec + dueIn;
      // Wide enough to exercise every board state, including early and untracked.
      const delay = r > 0.72 ? Math.round(150 + r * 1200) : r < 0.12 ? Math.round(-90 - r * 120) : Math.round((r - 0.4) * 100);
      const cancelled = r > 0.93;
      const untracked = r > 0.62 && r <= 0.66;
      if (scheduled > nowSec - 300) upcoming++;
      live.push({
        tripId: t.tripId,
        routeId: t.routeId,
        lineName: LINES.find((l) => l.defaultRouteId === t.routeId)?.name ?? t.routeId,
        stopId: s.stopId,
        stopName: s.stopName,
        stopSequence: i + 1,
        direction: t.directionId === 1 ? "inbound" : "outbound",
        serviceDate: today,
        scheduledArrival: scheduled,
        scheduledDeparture: scheduled + 60,
        observedArrival: cancelled || untracked ? null : scheduled + delay,
        delaySeconds: cancelled || untracked ? null : delay,
        stopSkipped: false,
        tripCancelled: cancelled,
        gtfsStaticVersion: versionId,
        ingestedAtMs: nowMs,
      });
    }
  }
  repos.events.recordMany(live);
  events += live.length;
  recomputeServiceDate(repos, today);

  // Live vehicle positions, so the map has trains on it.
  repos.vehicles.replaceAll(
    trips.slice(0, 18).map((t, i) => {
      const r = rand(1000 + i);
      return {
        vehicleId: `veh-${i}`,
        tripId: t.tripId,
        routeId: t.routeId,
        lineName: LINES.find((l) => l.defaultRouteId === t.routeId)?.name ?? t.routeId,
        direction: t.directionId === 1 ? ("inbound" as const) : ("outbound" as const),
        latitude: 40.3 + r * 0.6,
        longitude: -74.5 + r * 0.6,
        bearing: Math.round(r * 360),
        speedMetersPerSecond: 10 + r * 20,
        stopId: STOPS[i % STOPS.length]!.stopId,
        stopName: STOPS[i % STOPS.length]!.stopName,
        status: "in_transit_to" as const,
        reportedAt: nowSec - Math.round(r * 60),
        ingestedAtMs: nowMs,
      };
    }),
  );

  repos.health.setMeta("collection_start_date", toLocalDateString(nowSec - days * 86_400));
  for (const feed of ["TripUpdates", "VehiclePositions", "ServiceAlerts"] as const) {
    repos.health.recordSuccess(feed, nowMs);
  }

  return { days, events, upcoming };
}

/** True when the database already holds observations that did not come from here. */
export function hasRealObservations(repos: Repositories): boolean {
  const total = repos.events.count();
  return total > 0 && total !== repos.events.countSeedEvents();
}

/** The production volume mount — never a valid target for fabricated data. */
export function isProductionPath(dbPath: string): boolean {
  return dbPath.startsWith("/data/") || dbPath === "/data";
}
