import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  addDays,
  dateRange,
  findLineByName,
  gtfsStopTimeToEpochSeconds,
  parseGtfsTimeToSeconds,
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
  /** How many catalog lines to include in the SYNTHETIC fallback network. */
  lineCount?: number;
}

const SYNTHETIC_VERSION_ID = "seed-v1";
const INBOUND_HOURS = [6, 7, 8, 9, 16, 17, 18];
const OUTBOUND_HOURS = [7, 8, 17, 18, 19];

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

/** One stop on a line, with elapsed minutes from the line's first stop. */
interface LineStop {
  id: string;
  name: string;
  offset: number;
}
interface LineNetwork {
  routeId: string;
  lineName: string;
  inboundStops: LineStop[];
}

/** Build line networks from the real imported GTFS (real stops + coordinates). */
function realNetworks(repos: Repositories, versionId: string): LineNetwork[] {
  const stopName = new Map(repos.gtfs.allStops(versionId).map((s) => [s.stopId, s.stopName]));
  const networks: LineNetwork[] = [];
  for (const route of repos.gtfs.routes(versionId)) {
    const seq = repos.gtfs.representativeStopSequence(versionId, route.routeId);
    if (seq.length < 2) continue;
    const first = parseGtfsTimeToSeconds(seq[0]?.arrivalTime ?? "00:00:00");
    networks.push({
      routeId: route.routeId,
      lineName: route.lineName,
      inboundStops: seq.map((st) => ({
        id: st.stopId,
        name: stopName.get(st.stopId) ?? st.stopId,
        offset: Math.max(0, Math.round((parseGtfsTimeToSeconds(st.arrivalTime ?? "00:00:00") - first) / 60)),
      })),
    });
  }
  return networks;
}

/** Fallback network when no real GTFS has been imported (pure synthetic). */
function syntheticNetworks(lines: typeof RAIL_LINES): LineNetwork[] {
  const HUBS: LineStop[] = [
    { id: "SEC", name: "Secaucus Junction", offset: 40 },
    { id: "NYP", name: "New York Penn Station", offset: 52 },
  ];
  return lines.map((line) => ({
    routeId: line.defaultRouteId,
    lineName: line.name,
    inboundStops: [
      { id: `${line.defaultRouteId}-ORIG`, name: `${line.shortName} Origin`, offset: 0 },
      { id: `${line.defaultRouteId}-MID`, name: `${line.shortName} Midtown`, offset: 18 },
      ...HUBS,
    ],
  }));
}

interface SeedTrip {
  tripId: string;
  routeId: string;
  lineName: string;
  direction: Direction;
  directionId: number;
  stops: { id: string; name: string; offset: number; sequence: number }[];
  hour: number;
}

/** Generate peak-hour inbound/outbound trips traversing each line's stops. */
function buildTrips(networks: readonly LineNetwork[]): SeedTrip[] {
  const trips: SeedTrip[] = [];
  for (const net of networks) {
    const mkTrip = (direction: Direction, directionId: number, hour: number, order: LineStop[]): SeedTrip => {
      const first = order[0]?.offset ?? 0;
      return {
        tripId: `${net.routeId}-${direction}-${hour}`,
        routeId: net.routeId,
        lineName: net.lineName,
        direction,
        directionId,
        // Offsets are elapsed minutes from this trip's first stop (outbound reverses order).
        stops: order.map((s, i) => ({ id: s.id, name: s.name, offset: Math.abs(s.offset - first), sequence: i + 1 })),
        hour,
      };
    };
    for (const hour of INBOUND_HOURS) trips.push(mkTrip("inbound", 1, hour, net.inboundStops));
    const outbound = [...net.inboundStops].reverse();
    for (const hour of OUTBOUND_HOURS) trips.push(mkTrip("outbound", 0, hour, outbound));
  }
  return trips;
}

/**
 * Populate the database with reproducible synthetic *independent* measurements.
 * When the real GTFS feed has been imported (`npm run import:gtfs`), events are
 * generated on the real network — real stops, coordinates, and line names — so
 * every screen and the map run on real structure. Otherwise it falls back to a
 * self-contained synthetic catalog so the app still renders with no inputs.
 */
export function generateSyntheticData(repos: Repositories, options: SeedOptions = {}): { events: number; days: number } {
  const days = options.days ?? 30;
  const endDate = options.endDate ?? toLocalDateString(Math.floor(Date.now() / 1000));
  const startDate = addDays(endDate, -(days - 1));
  const dates = dateRange(startDate, endDate);
  const rng = makeRng(options.seed ?? 1);
  const nowMs = Date.now();

  const current = repos.gtfs.currentVersion();
  const realVersion = current && current.checksum !== "seed" ? current : null;

  let versionId: string;
  let networks: LineNetwork[];
  if (realVersion) {
    versionId = realVersion.versionId;
    networks = realNetworks(repos, realVersion.versionId);
  } else {
    versionId = SYNTHETIC_VERSION_ID;
    const lines = RAIL_LINES.slice(0, options.lineCount ?? RAIL_LINES.length);
    networks = syntheticNetworks(lines);
    seedSyntheticGtfs(repos, networks, nowMs);
  }

  const trips = buildTrips(networks);

  let eventCount = 0;
  for (const serviceDate of dates) {
    const events: TripStopEvent[] = [];
    for (const trip of trips) {
      const cancelled = rng() < 0.03;
      // ~20% of trips run chronically late; the rest cluster near on-time.
      const tripBias = rng() < 0.2 ? 240 + rng() * 1200 : rng() * 150;
      // Stop offsets are elapsed minutes (can exceed 60), so add to the base
      // instant rather than formatting an out-of-range "HH:MM".
      const baseArrival = gtfsStopTimeToEpochSeconds(serviceDate, hhmm(trip.hour, 0));
      for (const stop of trip.stops) {
        const scheduledArrival = baseArrival + stop.offset * 60;
        const delay = Math.round(tripBias + stop.sequence * rng() * 90 - 40);
        events.push({
          tripId: trip.tripId,
          routeId: trip.routeId,
          lineName: trip.lineName,
          stopId: stop.id,
          stopName: stop.name,
          stopSequence: stop.sequence,
          direction: trip.direction,
          serviceDate,
          scheduledArrival,
          scheduledDeparture: scheduledArrival + 60,
          observedArrival: cancelled ? null : scheduledArrival + delay,
          delaySeconds: cancelled ? null : delay,
          stopSkipped: false,
          tripCancelled: cancelled,
          gtfsStaticVersion: versionId,
          ingestedAtMs: nowMs,
        });
      }
    }
    repos.events.recordMany(events);
    eventCount += events.length;
    recomputeServiceDate(repos, serviceDate);
  }

  // Official NJT metrics come from the real performance CSVs (import:official),
  // not the seed. Alerts and pipeline health are synthetic.
  seedAlerts(repos, networks, endDate, rng);
  seedHealth(repos, startDate, endDate);

  return { events: eventCount, days: dates.length };
}

/** Write a self-contained synthetic GTFS catalog (fallback only). */
function seedSyntheticGtfs(repos: Repositories, networks: readonly LineNetwork[], nowMs: number): void {
  repos.gtfs.insertVersion({ versionId: SYNTHETIC_VERSION_ID, effectiveFrom: 0, effectiveTo: null, checksum: "seed", ingestedAtMs: nowMs });
  repos.gtfs.replaceRoutes(
    SYNTHETIC_VERSION_ID,
    networks.map((n) => ({ routeId: n.routeId, lineName: n.lineName })),
  );
  const stops = new Map<string, string>();
  for (const n of networks) for (const s of n.inboundStops) stops.set(s.id, s.name);
  repos.gtfs.replaceStops(SYNTHETIC_VERSION_ID, [...stops].map(([id, name]) => ({ stopId: id, stopName: name })));

  const trips = buildTrips(networks);
  repos.gtfs.replaceTrips(
    SYNTHETIC_VERSION_ID,
    trips.map((t) => ({ tripId: t.tripId, routeId: t.routeId, directionId: t.directionId })),
  );
  repos.gtfs.replaceStopTimes(
    SYNTHETIC_VERSION_ID,
    trips.flatMap((t) =>
      t.stops.map((s) => ({
        tripId: t.tripId,
        stopId: s.id,
        stopSequence: s.sequence,
        arrivalTime: hhmm(t.hour, s.offset),
        departureTime: hhmm(t.hour, s.offset),
      })),
    ),
  );
}

function seedAlerts(repos: Repositories, networks: readonly LineNetwork[], endDate: string, rng: () => number): void {
  const effects: EffectType[] = ["delay", "detour", "reduced_service", "modified_service"];
  const baseMs = gtfsStopTimeToEpochSeconds(endDate, "00:00:00") * 1000;
  for (let i = 0; i < 12; i++) {
    const net = networks[Math.floor(rng() * networks.length)] ?? networks[0];
    if (!net) break;
    const effect = effects[Math.floor(rng() * effects.length)] ?? "delay";
    const short = findLineByName(net.lineName)?.shortName ?? net.routeId;
    repos.alerts.upsert({
      alertId: `seed-alert-${i}`,
      affectedRoutes: [net.routeId],
      affectedStops: [],
      headerText: `${short}: ${effect.replace("_", " ")}`,
      descriptionText: `Synthetic ${effect} alert for ${net.lineName}.`,
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
