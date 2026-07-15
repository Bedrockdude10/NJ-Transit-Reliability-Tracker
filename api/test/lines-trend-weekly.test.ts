import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { LineTrendResponse } from "@njt/shared";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * Exercises the weekly `buildTrend` path (and its `weekStart` ISO-Monday math),
 * which the daily-only integration test doesn't reach. Seeds several days that
 * straddle a week boundary — including a Sunday (the `dow === 0` branch).
 */
function seedDays(): { app: Hono; repos: Repositories } {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);

  // 2025-07-13 is a Sunday; 07-14 Monday starts a new ISO week; 07-15 Tuesday.
  const days: [string, number, number, number][] = [
    // [serviceDate, operated, cancelled, onTime@900]
    ["2025-07-11", 100, 0, 90], // Fri  (week of Mon 07-07)
    ["2025-07-13", 100, 10, 80], // Sun (same week 07-07..07-13)
    ["2025-07-14", 50, 0, 50], // Mon (week of 07-14)
    ["2025-07-15", 50, 5, 40], // Tue (week of 07-14)
  ];
  for (const [serviceDate, operated, cancelled, onTime15] of days) {
    repos.aggregates.upsertOtpDaily({
      scope: "line",
      scopeId: "NE",
      serviceDate,
      direction: "all",
      tripsOperated: operated,
      tripsCancelled: cancelled,
      onTimeCounts: { "900": onTime15 },
      sumDelaySeconds: 0,
    });
  }
  return { app: createApp(repos), repos };
}

describe("GET /lines/:id/trend?interval=weekly", () => {
  let app: Hono;
  beforeEach(() => {
    app = seedDays().app;
  });

  it("groups daily rows into ISO weeks keyed by the Monday", async () => {
    const res = await app.request("/lines/NE/trend?interval=weekly&from=2025-07-11&to=2025-07-15");
    const body = (await res.json()) as LineTrendResponse;
    expect(body.interval).toBe("weekly");
    expect(body.points.map((p) => p.date)).toEqual(["2025-07-07", "2025-07-14"]);

    const week1 = body.points.find((p) => p.date === "2025-07-07");
    // Fri + Sun: operated 200, onTime15 170 → 85%; cancelled 10 of 210 scheduled → 4.8%
    expect(week1).toMatchObject({ tripsOperated: 200, otpPercent15Min: 85, cancellationRatePercent: 4.8 });

    const week2 = body.points.find((p) => p.date === "2025-07-14");
    // Mon + Tue: operated 100, onTime15 90 → 90%
    expect(week2).toMatchObject({ tripsOperated: 100, otpPercent15Min: 90 });
  });
});
