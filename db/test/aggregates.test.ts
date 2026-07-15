import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

describe("AggregateRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("stores and reads daily OTP rows over a range", () => {
    repos.aggregates.upsertOtpDaily({
      scope: "line",
      scopeId: "NE",
      serviceDate: "2025-07-15",
      direction: "all",
      tripsOperated: 100,
      tripsCancelled: 2,
      onTimeCounts: { "300": 80, "900": 95 },
      sumDelaySeconds: 12000,
    });
    repos.aggregates.upsertOtpDaily({
      scope: "line",
      scopeId: "NE",
      serviceDate: "2025-07-16",
      direction: "all",
      tripsOperated: 50,
      tripsCancelled: 0,
      onTimeCounts: { "300": 40, "900": 48 },
      sumDelaySeconds: 6000,
    });
    const rows = repos.aggregates.getOtpDailyRows("line", "NE", "all", "2025-07-15", "2025-07-16");
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.tripsOperated, 0)).toBe(150);
    expect(rows[0]?.onTimeCounts["300"]).toBe(80);
  });

  it("upsert replaces an existing daily row", () => {
    const row = {
      scope: "system" as const,
      scopeId: "system",
      serviceDate: "2025-07-15",
      direction: "all" as const,
      tripsOperated: 10,
      tripsCancelled: 0,
      onTimeCounts: { "300": 5 },
      sumDelaySeconds: 100,
    };
    repos.aggregates.upsertOtpDaily(row);
    repos.aggregates.upsertOtpDaily({ ...row, tripsOperated: 20 });
    const rows = repos.aggregates.getOtpDailyRows("system", "system", "all", "2025-07-15", "2025-07-15");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tripsOperated).toBe(20);
  });

  it("sums heatmap buckets across dates in SQL", () => {
    for (const date of ["2025-07-15", "2025-07-16"]) {
      repos.aggregates.upsertHeatmapDaily({
        scope: "system",
        scopeId: "system",
        type: "hour_of_day",
        bucket: 8,
        serviceDate: date,
        sumDelaySeconds: 600,
        observations: 10,
      });
    }
    const buckets = repos.aggregates.sumHeatmap("system", "system", "hour_of_day", "2025-07-15", "2025-07-16");
    expect(buckets).toEqual([{ bucket: 8, sumDelaySeconds: 1200, observations: 20 }]);
  });

  it("ranks worst trips for a route by average terminal delay", () => {
    repos.aggregates.upsertTripDaily({
      tripId: "fast",
      serviceDate: "2025-07-15",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      direction: "inbound",
      terminalStopName: "New York Penn",
      terminalDelaySeconds: 60,
    });
    repos.aggregates.upsertTripDaily({
      tripId: "slow",
      serviceDate: "2025-07-15",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      direction: "inbound",
      terminalStopName: "New York Penn",
      terminalDelaySeconds: 1200,
    });
    const worst = repos.aggregates.worstTripsForRoute("NE", "2025-07-15", "2025-07-15", 10);
    expect(worst.map((t) => t.tripId)).toEqual(["slow", "fast"]);
    expect(worst[0]?.avgTerminalDelaySeconds).toBe(1200);
  });

  it("clearServiceDate wipes a day's aggregates for recompute", () => {
    repos.aggregates.upsertOtpDaily({
      scope: "system",
      scopeId: "system",
      serviceDate: "2025-07-15",
      direction: "all",
      tripsOperated: 10,
      tripsCancelled: 0,
      onTimeCounts: {},
      sumDelaySeconds: 0,
    });
    repos.aggregates.clearServiceDate("2025-07-15");
    expect(repos.aggregates.getOtpDailyRows("system", "system", "all", "2025-07-15", "2025-07-15")).toHaveLength(0);
  });

  it("returns connection rows and ranks top triples", () => {
    repos.aggregates.upsertConnectionDaily({
      inboundTripId: "IN1",
      transferStopId: "STX",
      outboundTripId: "OUT1",
      serviceDate: "2025-07-15",
      observations: 20,
      successes: 18,
      peakObservations: 10,
      peakSuccesses: 9,
      offPeakObservations: 10,
      offPeakSuccesses: 9,
      byDayOfWeek: { "2": { observations: 20, successes: 18 } },
      inboundDelayDistribution: { "0-5 min": 18, "5-10 min": 2 },
    });
    const rows = repos.aggregates.getConnectionRows("IN1", "STX", "OUT1", "2025-07-01", "2025-07-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.byDayOfWeek["2"]?.successes).toBe(18);
    expect(repos.aggregates.topConnectionTriples(5, "2025-07-01", "2025-07-31")[0]?.observations).toBe(20);
  });

  it("topConnectionTriples respects the service-date window and sums within it", () => {
    const base = {
      inboundTripId: "IN1",
      transferStopId: "STX",
      outboundTripId: "OUT1",
      peakObservations: 0,
      peakSuccesses: 0,
      offPeakObservations: 0,
      offPeakSuccesses: 0,
      byDayOfWeek: {},
      inboundDelayDistribution: {},
    };
    // Two in-window days for the same triple (should sum) plus one out-of-window day.
    repos.aggregates.upsertConnectionDaily({ ...base, serviceDate: "2025-07-15", observations: 20, successes: 18 });
    repos.aggregates.upsertConnectionDaily({ ...base, serviceDate: "2025-07-16", observations: 5, successes: 4 });
    repos.aggregates.upsertConnectionDaily({ ...base, serviceDate: "2025-06-01", observations: 100, successes: 90 });

    const inWindow = repos.aggregates.topConnectionTriples(5, "2025-07-01", "2025-07-31");
    expect(inWindow).toHaveLength(1);
    expect(inWindow[0]?.observations).toBe(25); // 20 + 16's day, excludes the June 1 row

    const empty = repos.aggregates.topConnectionTriples(5, "2025-08-01", "2025-08-31");
    expect(empty).toEqual([]);
  });
});
