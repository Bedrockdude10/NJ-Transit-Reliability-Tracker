/**
 * LOCAL DEV FIXTURE — synthetic data, for running the app populated on a laptop.
 *
 * This is the single source for "what a populated database looks like". It is
 * used by two callers ONLY:
 *   1. the API integration tests (`api/test/seed.ts` → `seedFixture`), and
 *   2. the `npm run dev:seed` CLI (`seedFixture` + `seedRecentDevData`).
 *
 * It is deliberately NOT imported by the running API (`main.ts`/`app.ts`) or the
 * deploy path, so it does not affect the product's no-synthetic-data guarantee
 * (that guarantee is about the *deployed* feed). If this data ever lands in a
 * real database, `deploy/purge-synthetic.mjs` clears it.
 *
 * `seedFixture` is the deterministic single-day fixture the tests assert on — do
 * not change its numbers. `seedRecentDevData` layers a rich, *recent*,
 * multi-day/multi-line dataset on top so the default dashboard window is never
 * empty during local development.
 */

import type { Repositories } from "@njt/db";
import { addDays, parseDateString } from "@njt/shared";

export const SEED_DATE = "2025-07-15";
const SEEN_MS = Date.UTC(2025, 6, 15, 12, 0, 0);

/**
 * Deterministic one-day fixture over the given repositories. Shared with the API
 * integration tests, which assert exact values for {@link SEED_DATE} — keep the
 * numbers stable.
 */
export function seedFixture(repos: Repositories): void {
  const NEC = "Northeast Corridor Line";

  // --- GTFS catalog ---------------------------------------------------------
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c1", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: NEC, color: "DD3439" }]);
  repos.gtfs.replaceStops("v1", [
    { stopId: "NWK", stopName: "Newark Penn", stopLat: 40.7347, stopLon: -74.1644 },
    { stopId: "NYP", stopName: "New York Penn", stopLat: 40.7506, stopLon: -73.9936 },
  ]);
  repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 0 }]);
  repos.gtfs.replaceStopTimes("v1", [
    { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
    { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "08:20:00", departureTime: "08:21:00" },
  ]);

  // --- OTP + distribution + heatmaps (system and line NE) -------------------
  for (const [scope, scopeId] of [["system", "system"], ["line", "NE"]] as const) {
    repos.aggregates.upsertOtpDaily({
      scope,
      scopeId,
      serviceDate: SEED_DATE,
      direction: "all",
      tripsOperated: 100,
      tripsCancelled: 5,
      onTimeCounts: { "300": 70, "600": 85, "900": 92, "1800": 98, "3600": 100 },
      sumDelaySeconds: 30000,
    });
    repos.aggregates.upsertDelayDistributionDaily({
      scope,
      scopeId,
      serviceDate: SEED_DATE,
      counts: { early: 10, "0-5 min": 60, "5-10 min": 15, "10-15 min": 7, "15-30 min": 6, "30-60 min": 2, "60+ min": 0 },
    });
    repos.aggregates.upsertHeatmapDaily({ scope, scopeId, type: "hour_of_day", bucket: 8, serviceDate: SEED_DATE, sumDelaySeconds: 600, observations: 10 });
    repos.aggregates.upsertHeatmapDaily({ scope, scopeId, type: "day_of_week", bucket: 2, serviceDate: SEED_DATE, sumDelaySeconds: 600, observations: 10 });
  }

  repos.aggregates.upsertOtpDaily({
    scope: "line", scopeId: "NE", serviceDate: SEED_DATE, direction: "inbound",
    tripsOperated: 50, tripsCancelled: 2, onTimeCounts: { "900": 46 }, sumDelaySeconds: 12000,
  });
  repos.aggregates.upsertOtpDaily({
    scope: "line", scopeId: "NE", serviceDate: SEED_DATE, direction: "outbound",
    tripsOperated: 50, tripsCancelled: 3, onTimeCounts: { "900": 46 }, sumDelaySeconds: 18000,
  });

  // --- Trips, stations, connection, official, alerts, health ----------------
  repos.aggregates.upsertTripDaily({
    tripId: "T1", serviceDate: SEED_DATE, routeId: "NE", lineName: NEC,
    direction: "inbound", terminalStopName: "New York Penn", terminalDelaySeconds: 1200,
  });
  repos.aggregates.upsertStationDaily({
    stopId: "NWK", serviceDate: SEED_DATE, lineName: NEC, direction: "inbound",
    sumArrivalDelaySeconds: 6000, observations: 50, arrivedWithin5Min: 40, departedLateAfterOnTimeArrival: 8,
  });
  repos.aggregates.upsertStationHourly({ stopId: "NWK", serviceDate: SEED_DATE, hour: 8, sumDelaySeconds: 600, observations: 10 });
  repos.aggregates.upsertStationDistributionDaily({ stopId: "NWK", serviceDate: SEED_DATE, counts: { "0-5 min": 40, "5-10 min": 10 } });

  repos.events.record({
    tripId: "T1", routeId: "NE", lineName: NEC, stopId: "NWK", stopName: "Newark Penn",
    stopSequence: 1, direction: "inbound", serviceDate: SEED_DATE,
    scheduledArrival: 1000, scheduledDeparture: 1060, observedArrival: 2200,
    delaySeconds: 1200, stopSkipped: false, tripCancelled: false, gtfsStaticVersion: "v1", ingestedAtMs: SEEN_MS,
  });

  repos.aggregates.upsertConnectionDaily({
    inboundTripId: "T1", transferStopId: "NWK", outboundTripId: "T2", serviceDate: SEED_DATE,
    observations: 40, successes: 36, peakObservations: 20, peakSuccesses: 18,
    offPeakObservations: 20, offPeakSuccesses: 18,
    byDayOfWeek: { "2": { observations: 40, successes: 36 } },
    inboundDelayDistribution: { "0-5 min": 36, "5-10 min": 4 },
  });

  repos.official.upsert({
    year: 2025, month: 7, lineName: NEC, otpPercent: 88.5, otpPercentAmtrakAdjusted: 91.2,
    tripsOperated: 3000, cancellations: 50, cancellationCauses: { AMTRAK: 30, Mechanical: 20 },
  });
  repos.official.upsertMdbf({ year: 2025, month: 7, mdbf: 90000 });

  repos.lightRail.upsertOtp({ year: 2025, month: 7, otpPercent: 96.5 });
  repos.lightRail.upsertMdbf({ year: 2025, month: 7, lineName: "Hudson-Bergen Light Rail", mdbf: 30000 });

  repos.alerts.upsert({
    alertId: "A1", affectedRoutes: ["NE"], affectedStops: ["NWK"],
    headerText: "Delays on the NEC", descriptionText: "Signal trouble near Newark.",
    effectType: "delay", activeFrom: null, activeTo: null, ingestedAtMs: SEEN_MS,
  });

  repos.health.ensureCollectionStart("2025-07-01");
  repos.health.recordSuccess("TripUpdates", SEEN_MS);
}

// ---------------------------------------------------------------------------
// Dev-only "recent data" layer. Runs only from `npm run dev:seed`, never in
// tests, so it is free to be rich and to overwrite the minimal test catalog.
// ---------------------------------------------------------------------------

interface DevLine {
  routeId: string;
  lineName: string;
  color: string;
  /** Ordered stops (id, name, lat, lon) tracing the line for the map path. */
  stops: { id: string; name: string; lat: number; lon: number }[];
  /** Baseline on-time ratios for the 5 OTP thresholds (worse → better line). */
  ratios: [number, number, number, number, number];
  /** Latest published NJT 6-min OTP; older months drift down from here. */
  njtOtp: number;
}

const DEV_LINES: DevLine[] = [
  {
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    color: "DD3439",
    stops: [
      { id: "TRE", name: "Trenton", lat: 40.2185, lon: -74.7563 },
      { id: "NWK", name: "Newark Penn", lat: 40.7347, lon: -74.1644 },
      { id: "SEC", name: "Secaucus Junction", lat: 40.7616, lon: -74.0759 },
      { id: "NYP", name: "New York Penn", lat: 40.7506, lon: -73.9936 },
    ],
    ratios: [0.52, 0.7, 0.83, 0.94, 0.99],
    njtOtp: 88.5,
  },
  {
    routeId: "NC",
    lineName: "North Jersey Coast Line",
    color: "00A6E2",
    stops: [
      { id: "LBH", name: "Long Branch", lat: 40.2969, lon: -73.9857 },
      { id: "RAH", name: "Rahway", lat: 40.6187, lon: -74.2777 },
      { id: "NWK", name: "Newark Penn", lat: 40.7347, lon: -74.1644 },
      { id: "NYP", name: "New York Penn", lat: 40.7506, lon: -73.9936 },
    ],
    ratios: [0.58, 0.75, 0.87, 0.95, 0.99],
    njtOtp: 91.2,
  },
];

const DELAY_BUCKET_LABELS = ["early", "0-5 min", "5-10 min", "10-15 min", "15-30 min", "30-60 min", "60+ min"] as const;

/** On-time counts for every OTP threshold, given operated trips and ratios. */
function onTimeCounts(operated: number, ratios: readonly number[]): Record<string, number> {
  const thresholds = ["300", "600", "900", "1800", "3600"];
  const out: Record<string, number> = {};
  thresholds.forEach((key, i) => (out[key] = Math.round(operated * (ratios[i] ?? 1))));
  return out;
}

/** A plausible delay-distribution histogram summing to `operated`. */
function delayDistribution(operated: number, ratios: readonly number[]): Record<string, number> {
  const within5 = Math.round(operated * (ratios[0] ?? 0.55));
  const to10 = Math.round(operated * 0.16);
  const to15 = Math.round(operated * 0.1);
  const to30 = Math.round(operated * 0.09);
  const to60 = Math.round(operated * 0.04);
  const early = Math.round(operated * 0.05);
  const over60 = Math.max(0, operated - within5 - to10 - to15 - to30 - to60 - early);
  return {
    early,
    "0-5 min": within5,
    "5-10 min": to10,
    "10-15 min": to15,
    "15-30 min": to30,
    "30-60 min": to60,
    "60+ min": over60,
  };
}

/**
 * Layer rich, recent, multi-line data ending on `today` (a `YYYY-MM-DD`) so the
 * default dashboard window is populated for local development. Idempotent.
 */
export function seedRecentDevData(repos: Repositories, today: string): void {
  const RECENT_DAYS = 45;
  const OFFICIAL_MONTHS = 18;

  // --- Richer GTFS network (replaces the minimal test catalog on v1, which
  // `seedFixture` created — the dev CLI always runs that first) --------------
  repos.gtfs.replaceRoutes(
    "v1",
    DEV_LINES.map((l) => ({ routeId: l.routeId, lineName: l.lineName, color: l.color })),
  );
  const stopById = new Map<string, { id: string; name: string; lat: number; lon: number }>();
  for (const line of DEV_LINES) for (const s of line.stops) stopById.set(s.id, s);
  repos.gtfs.replaceStops(
    "v1",
    [...stopById.values()].map((s) => ({ stopId: s.id, stopName: s.name, stopLat: s.lat, stopLon: s.lon })),
  );
  repos.gtfs.replaceTrips("v1", DEV_LINES.map((l) => ({ tripId: `${l.routeId}-trip`, routeId: l.routeId, directionId: 0 })));
  repos.gtfs.replaceStopTimes(
    "v1",
    DEV_LINES.flatMap((l) =>
      l.stops.map((s, i) => ({
        tripId: `${l.routeId}-trip`,
        stopId: s.id,
        stopSequence: i + 1,
        arrivalTime: `${String(6 + i).padStart(2, "0")}:00:00`,
        departureTime: `${String(6 + i).padStart(2, "0")}:01:00`,
      })),
    ),
  );

  // --- Recent daily OTP + distribution (system + per line) ------------------
  for (let offset = 0; offset < RECENT_DAYS; offset++) {
    const serviceDate = addDays(today, -offset);
    const wobble = ((offset % 7) - 3) * 0.01; // gentle day-to-day variation
    let sysOperated = 0;
    let sysCancelled = 0;
    let sysSumDelay = 0;
    const sysOnTime: Record<string, number> = { "300": 0, "600": 0, "900": 0, "1800": 0, "3600": 0 };
    const sysDist: Record<string, number> = {};

    for (const line of DEV_LINES) {
      const operated = 240 + ((offset * 7 + line.routeId.charCodeAt(1)) % 40);
      const cancelled = 2 + (offset % 4);
      const ratios = line.ratios.map((r) => Math.min(0.999, Math.max(0, r + wobble)));
      const onTime = onTimeCounts(operated, ratios);
      const sumDelay = operated * (240 + (offset % 5) * 30);
      const dist = delayDistribution(operated, ratios);

      repos.aggregates.upsertOtpDaily({
        scope: "line", scopeId: line.routeId, serviceDate, direction: "all",
        tripsOperated: operated, tripsCancelled: cancelled, onTimeCounts: onTime, sumDelaySeconds: sumDelay,
      });
      repos.aggregates.upsertDelayDistributionDaily({ scope: "line", scopeId: line.routeId, serviceDate, counts: dist });

      // Directional split (~half each), so the inbound/outbound card populates.
      const half = Math.floor(operated / 2);
      for (const direction of ["inbound", "outbound"] as const) {
        repos.aggregates.upsertOtpDaily({
          scope: "line", scopeId: line.routeId, serviceDate, direction,
          tripsOperated: half, tripsCancelled: Math.floor(cancelled / 2),
          onTimeCounts: onTimeCounts(half, ratios), sumDelaySeconds: Math.floor(sumDelay / 2),
        });
      }

      sysOperated += operated;
      sysCancelled += cancelled;
      sysSumDelay += sumDelay;
      for (const key of Object.keys(sysOnTime)) sysOnTime[key] = (sysOnTime[key] ?? 0) + (onTime[key] ?? 0);
      for (const label of DELAY_BUCKET_LABELS) sysDist[label] = (sysDist[label] ?? 0) + (dist[label] ?? 0);
    }

    repos.aggregates.upsertOtpDaily({
      scope: "system", scopeId: "system", serviceDate, direction: "all",
      tripsOperated: sysOperated, tripsCancelled: sysCancelled, onTimeCounts: sysOnTime, sumDelaySeconds: sysSumDelay,
    });
    repos.aggregates.upsertDelayDistributionDaily({ scope: "system", scopeId: "system", serviceDate, counts: sysDist });
  }

  // --- Full heatmap grids (one recent date each; the API sums over range) ---
  const heatDate = today;
  for (const scopeId of ["system", ...DEV_LINES.map((l) => l.routeId)]) {
    const scope = scopeId === "system" ? "system" : "line";
    for (let hour = 5; hour <= 23; hour++) {
      const rush = hour === 8 || hour === 9 || hour === 17 || hour === 18 ? 2 : 1;
      repos.aggregates.upsertHeatmapDaily({
        scope, scopeId, type: "hour_of_day", bucket: hour, serviceDate: heatDate,
        sumDelaySeconds: 120 * rush * 20, observations: 20,
      });
    }
    for (let dow = 0; dow <= 6; dow++) {
      const weekday = dow >= 1 && dow <= 5 ? 1.6 : 1;
      repos.aggregates.upsertHeatmapDaily({
        scope, scopeId, type: "day_of_week", bucket: dow, serviceDate: heatDate,
        sumDelaySeconds: Math.round(180 * weekday * 30), observations: 30,
      });
    }
  }

  // --- Worst trips + a station + connections on recent dates ----------------
  for (let offset = 0; offset < 5; offset++) {
    const serviceDate = addDays(today, -offset);
    for (const line of DEV_LINES) {
      const terminalName = line.stops[line.stops.length - 1]?.name ?? line.lineName;
      repos.aggregates.upsertTripDaily({
        tripId: `${line.routeId}-${100 + offset}`, serviceDate, routeId: line.routeId, lineName: line.lineName,
        direction: "inbound", terminalStopName: terminalName, terminalDelaySeconds: 600 + offset * 180,
      });
    }
    repos.aggregates.upsertStationDaily({
      stopId: "NWK", serviceDate, lineName: "Northeast Corridor Line", direction: "inbound",
      sumArrivalDelaySeconds: 9000, observations: 60, arrivedWithin5Min: 48, departedLateAfterOnTimeArrival: 9,
    });
    repos.aggregates.upsertStationHourly({ stopId: "NWK", serviceDate, hour: 8, sumDelaySeconds: 900, observations: 15 });
    repos.aggregates.upsertStationDistributionDaily({ stopId: "NWK", serviceDate, counts: { "0-5 min": 45, "5-10 min": 10, "10-15 min": 5 } });
    repos.aggregates.upsertConnectionDaily({
      inboundTripId: "NE-100", transferStopId: "NWK", outboundTripId: "NC-100", serviceDate,
      observations: 50, successes: 44, peakObservations: 25, peakSuccesses: 21, offPeakObservations: 25, offPeakSuccesses: 23,
      byDayOfWeek: { "1": { observations: 10, successes: 9 }, "3": { observations: 20, successes: 17 }, "5": { observations: 20, successes: 18 } },
      inboundDelayDistribution: { "0-5 min": 40, "5-10 min": 7, "10-15 min": 3 },
    });
  }

  // --- Recent published NJT months (per line + system MDBF) -----------------
  const t0 = parseDateString(today);
  for (let i = 1; i <= OFFICIAL_MONTHS; i++) {
    let month = t0.month - i;
    let year = t0.year;
    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    const seasonal = month >= 12 || month <= 2 ? -4 : 0; // winters run worse
    for (const line of DEV_LINES) {
      const otp = Math.round((line.njtOtp + seasonal - (i % 3)) * 10) / 10;
      repos.official.upsert({
        year, month, lineName: line.lineName, otpPercent: otp,
        otpPercentAmtrakAdjusted: Math.round((otp + 2.5) * 10) / 10,
        tripsOperated: 3000, cancellations: 40 + (i % 5) * 5,
        cancellationCauses: { AMTRAK: 20, Mechanical: 12, Weather: 8 },
      });
    }
    repos.official.upsertMdbf({ year, month, mdbf: 95000 - (i % 6) * 1500 });
    repos.lightRail.upsertOtp({ year, month, otpPercent: Math.round((96 + seasonal / 2) * 10) / 10 });
  }
  repos.lightRail.upsertMdbf({ year: t0.year, month: t0.month, lineName: "Hudson-Bergen Light Rail", mdbf: 31000 });
  repos.lightRail.upsertMdbf({ year: t0.year, month: t0.month, lineName: "Newark Light Rail", mdbf: 18000 });

  // --- Recent alerts + collection start anchored before the window ----------
  const nowMs = Date.parse(`${today}T12:00:00Z`);
  repos.alerts.upsert({
    alertId: "DEV-1", affectedRoutes: ["NE"], affectedStops: ["NWK"],
    headerText: "Residual delays on the Northeast Corridor", descriptionText: "Earlier signal trouble near Newark; expect 10-15 minute delays.",
    effectType: "delay", activeFrom: Math.floor(nowMs / 1000) - 3600, activeTo: null, ingestedAtMs: nowMs,
  });
  repos.alerts.upsert({
    alertId: "DEV-2", affectedRoutes: ["NC"], affectedStops: ["LBH"],
    headerText: "North Jersey Coast Line detour", descriptionText: "Buses replace trains south of Long Branch this weekend.",
    effectType: "detour", activeFrom: Math.floor(nowMs / 1000), activeTo: Math.floor(nowMs / 1000) + 172800, ingestedAtMs: nowMs,
  });

  repos.health.ensureCollectionStart(addDays(today, -RECENT_DAYS));
  repos.health.recordSuccess("TripUpdates", nowMs);
  repos.health.recordSuccess("VehiclePositions", nowMs);
  repos.health.recordSuccess("Alerts", nowMs);
}
