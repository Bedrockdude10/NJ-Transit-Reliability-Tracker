import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { Hono } from "hono";
import { createApp } from "../src/app";

export const SEED_DATE = "2025-07-15";
const SEEN_MS = Date.UTC(2025, 6, 15, 12, 0, 0);

/** Build an API over an in-memory db seeded with one day of realistic data. */
export function seededApp(): { app: Hono; repos: Repositories } {
  const repos = createRepositories(openDatabase());
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

  return { app: createApp(repos), repos };
}
