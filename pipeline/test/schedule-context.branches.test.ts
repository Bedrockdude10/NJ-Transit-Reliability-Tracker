import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { describe, expect, it } from "vitest";
import { createScheduleContext } from "../src/gtfs-rt/schedule-context";

const DATE = "2025-07-15";

function seed(): Repositories {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
  repos.gtfs.replaceStops("v1", [{ stopId: "NWK", stopName: "Newark Penn" }]);
  return repos;
}

describe("createScheduleContext — branch coverage", () => {
  it("returns null when the trip exists but has no stop times", () => {
    const repos = seed();
    repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
    // No stop_times for T1.
    const ctx = createScheduleContext(repos.gtfs);
    expect(ctx.lookup("T1", DATE)).toBeNull();
  });

  it("resolves null scheduled times when a stop time lacks arrival/departure", () => {
    const repos = seed();
    repos.gtfs.replaceTrips("v1", [{ tripId: "T2", routeId: "NE", directionId: 0 }]);
    repos.gtfs.replaceStopTimes("v1", [
      { tripId: "T2", stopId: "NWK", stopSequence: 1, arrivalTime: null, departureTime: null },
    ]);
    const ctx = createScheduleContext(repos.gtfs);
    const schedule = ctx.lookup("T2", DATE);
    expect(schedule?.stops[0]).toMatchObject({ scheduledArrival: null, scheduledDeparture: null });
    expect(schedule?.direction).toBe("outbound");
  });

  it("falls back to the route id when the line name is unknown", () => {
    const repos = createRepositories(openDatabase());
    repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
    // No routes registered, so lineNameForRoute returns null.
    repos.gtfs.replaceTrips("v1", [{ tripId: "T3", routeId: "MYSTERY", directionId: 1 }]);
    repos.gtfs.replaceStopTimes("v1", [
      { tripId: "T3", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
    ]);
    const ctx = createScheduleContext(repos.gtfs);
    expect(ctx.lookup("T3", DATE)?.lineName).toBe("MYSTERY");
  });

  it("caches stop names across repeated lookups", () => {
    const repos = seed();
    const ctx = createScheduleContext(repos.gtfs);
    expect(ctx.stopName("NWK")).toBe("Newark Penn");
    expect(ctx.stopName("NWK")).toBe("Newark Penn"); // served from cache
    // Unknown stop id caches the fallback (the raw id) too.
    expect(ctx.stopName("ZZZ")).toBe("ZZZ");
    expect(ctx.stopName("ZZZ")).toBe("ZZZ");
  });
});
