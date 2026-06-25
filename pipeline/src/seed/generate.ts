import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  addDays,
  dateRange,
  gtfsStopTimeToEpochSeconds,
  toLocalDateString,
  type Direction,
  type EffectType,
  type TripStopEvent,
} from "@njt/shared";
import { recomputeServiceDate } from "../aggregator";

/** Deterministic PRNG (mulberry32) so seeded data is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  days?: number;
  endDate?: string;
  seed?: number;
  /** How many of the catalog lines to include. */
  lineCount?: number;
}

const VERSION_ID = "seed-v1";
const HUBS = [
  { id: "SEC", name: "Secaucus Junction", offset: 40 },
  { id: "NYP", name: "New York Penn Station", offset: 52 },
];
const INBOUND_HOURS = [6, 7, 8, 9, 16, 17, 18];
const OUTBOUND_HOURS = [7, 8, 17, 18, 19];

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

interface StopDef {
  id: string;
  name: string;
  offset: number; // minutes from the trip's first stop
}

/**
 * Populate the database with reproducible synthetic data: a GTFS catalog, a
 * span of daily TripStopEvents with realistic delay tails, recomputed
 * aggregates, official NJT metrics, alerts, and pipeline health. Used by the
 * seed script and tests so the API/dashboard render without live feeds.
 */
export function generateSyntheticData(repos: Repositories, options: SeedOptions = {}): { events: number; days: number } {
  const days = options.days ?? 30;
  const endDate = options.endDate ?? toLocalDateString(Math.floor(Date.now() / 1000));
  const startDate = addDays(endDate, -(days - 1));
  const dates = dateRange(startDate, endDate);
  const rng = makeRng(options.seed ?? 1);
  const lines = RAIL_LINES.slice(0, options.lineCount ?? 6);
  const nowMs = Date.now();

  // --- GTFS catalog ---------------------------------------------------------
  repos.gtfs.insertVersion({ versionId: VERSION_ID, effectiveFrom: 0, effectiveTo: null, checksum: "seed", ingestedAtMs: nowMs });
  const stopsSeen = new Map<string, string>();
  const addStop = (id: string, name: string) => stopsSeen.set(id, name);

  interface SeedTrip {
    tripId: string;
    routeId: string;
    direction: Direction;
    directionId: number;
    stops: { def: StopDef; sequence: number }[];
    hour: number;
  }
  const trips: SeedTrip[] = [];

  for (const line of lines) {
    const inboundStops: StopDef[] = [
      { id: `${line.defaultRouteId}-ORIG`, name: `${line.shortName} Origin`, offset: 0 },
      { id: `${line.defaultRouteId}-MID`, name: `${line.shortName} Midtown`, offset: 18 },
      ...HUBS,
    ];
    for (const s of inboundStops) addStop(s.id, s.name);

    const buildTrip = (direction: Direction, directionId: number, hour: number, order: StopDef[]): SeedTrip => {
      const first = order[0]?.offset ?? 0;
      // Offsets are elapsed minutes from this trip's first stop (non-negative
      // in either direction, since outbound reverses the inbound order).
      const stops = order.map((def, i) => ({ def: { ...def, offset: Math.abs(def.offset - first) }, sequence: i + 1 }));
      return { tripId: `${line.defaultRouteId}-${direction}-${hour}`, routeId: line.defaultRouteId, direction, directionId, stops, hour };
    };

    for (const hour of INBOUND_HOURS) trips.push(buildTrip("inbound", 1, hour, inboundStops));
    for (const hour of OUTBOUND_HOURS) trips.push(buildTrip("outbound", 0, hour, [...inboundStops].reverse()));
  }

  repos.gtfs.replaceRoutes(VERSION_ID, lines.map((l) => ({ routeId: l.defaultRouteId, lineName: l.name })));
  repos.gtfs.replaceStops(VERSION_ID, [...stopsSeen.entries()].map(([id, name]) => ({ stopId: id, stopName: name })));
  repos.gtfs.replaceTrips(
    VERSION_ID,
    trips.map((t) => ({ tripId: t.tripId, routeId: t.routeId, directionId: t.directionId })),
  );
  repos.gtfs.replaceStopTimes(
    VERSION_ID,
    trips.flatMap((t) =>
      t.stops.map((s) => ({
        tripId: t.tripId,
        stopId: s.def.id,
        stopSequence: s.sequence,
        arrivalTime: hhmm(t.hour, s.def.offset),
        departureTime: hhmm(t.hour, s.def.offset),
      })),
    ),
  );

  // --- Daily events ---------------------------------------------------------
  let eventCount = 0;
  const lineName = new Map(lines.map((l) => [l.defaultRouteId, l.name]));

  for (const serviceDate of dates) {
    const events: TripStopEvent[] = [];
    for (const trip of trips) {
      const cancelled = rng() < 0.03;
      // ~20% of trips run chronically late; the rest cluster near on-time.
      const tripBias = rng() < 0.2 ? 240 + rng() * 1200 : rng() * 150;
      for (const stop of trip.stops) {
        const scheduledArrival = gtfsStopTimeToEpochSeconds(serviceDate, hhmm(trip.hour, stop.def.offset));
        const delay = Math.round(tripBias + stop.sequence * rng() * 90 - 40);
        events.push({
          tripId: trip.tripId,
          routeId: trip.routeId,
          lineName: lineName.get(trip.routeId) ?? trip.routeId,
          stopId: stop.def.id,
          stopName: stopsSeen.get(stop.def.id) ?? stop.def.id,
          stopSequence: stop.sequence,
          direction: trip.direction,
          serviceDate,
          scheduledArrival,
          scheduledDeparture: scheduledArrival + 60,
          observedArrival: cancelled ? null : scheduledArrival + delay,
          delaySeconds: cancelled ? null : delay,
          stopSkipped: false,
          tripCancelled: cancelled,
          gtfsStaticVersion: VERSION_ID,
          ingestedAtMs: nowMs,
        });
      }
    }
    repos.events.recordMany(events);
    eventCount += events.length;
    recomputeServiceDate(repos, serviceDate);
  }

  seedOfficialMetrics(repos, lines, startDate, endDate, rng);
  seedAlerts(repos, lines, endDate, rng);
  seedHealth(repos, startDate, endDate);

  return { events: eventCount, days: dates.length };
}

function seedOfficialMetrics(
  repos: Repositories,
  lines: typeof RAIL_LINES,
  startDate: string,
  endDate: string,
  rng: () => number,
): void {
  const start = Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)) - 1;
  const end = Number(endDate.slice(0, 4)) * 12 + Number(endDate.slice(5, 7)) - 1;
  for (let m = start; m <= end; m++) {
    const year = Math.floor(m / 12);
    const month = (m % 12) + 1;
    for (const line of lines) {
      const otp = 80 + rng() * 12; // NJT's loose 6-min figure looks rosy
      repos.official.upsert({
        year,
        month,
        lineName: line.name,
        otpPercent: Math.round(otp * 10) / 10,
        otpPercentAmtrakAdjusted: line.hasAmtrakAttribution ? Math.round((otp + 3) * 10) / 10 : null,
        tripsOperated: 2000 + Math.floor(rng() * 2000),
        cancellations: Math.floor(rng() * 60),
      });
    }
  }
}

function seedAlerts(repos: Repositories, lines: typeof RAIL_LINES, endDate: string, rng: () => number): void {
  const effects: EffectType[] = ["delay", "detour", "reduced_service", "modified_service"];
  const baseMs = gtfsStopTimeToEpochSeconds(endDate, "00:00:00") * 1000;
  for (let i = 0; i < 12; i++) {
    const line = lines[Math.floor(rng() * lines.length)] ?? lines[0]!;
    const effect = effects[Math.floor(rng() * effects.length)] ?? "delay";
    repos.alerts.upsert({
      alertId: `seed-alert-${i}`,
      affectedRoutes: [line.defaultRouteId],
      affectedStops: [],
      headerText: `${line.shortName}: ${effect.replace("_", " ")}`,
      descriptionText: `Synthetic ${effect} alert for ${line.name}.`,
      effectType: effect,
      activeFrom: Math.floor(baseMs / 1000),
      activeTo: null,
      ingestedAtMs: baseMs - i * 86_400_000,
    });
  }
}

function seedHealth(repos: Repositories, startDate: string, endDate: string): void {
  repos.health.ensureCollectionStart(startDate);
  const endMs = gtfsStopTimeToEpochSeconds(endDate, "12:00:00") * 1000;
  for (const feed of ["TripUpdates", "VehiclePositions", "ServiceAlerts"]) {
    repos.health.recordSuccess(feed, endMs);
  }
}
