import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { describe, expect, it, vi } from "vitest";
import { createScheduleCache, createScheduleContext } from "../src/gtfs-rt/schedule-context";

const DATE = "2025-07-15";

function seed(versionId = "v1", effectiveFrom = 0): Repositories {
  const repos = createRepositories(openDatabase());
  seedVersion(repos, versionId, effectiveFrom);
  return repos;
}

function seedVersion(repos: Repositories, versionId: string, effectiveFrom: number): void {
  repos.gtfs.insertVersion({ versionId, effectiveFrom, effectiveTo: null, checksum: `c-${versionId}`, ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes(versionId, [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
  repos.gtfs.replaceStops(versionId, [{ stopId: "NWK", stopName: "Newark Penn" }]);
  repos.gtfs.replaceTrips(versionId, [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
  repos.gtfs.replaceStopTimes(versionId, [
    { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
  ]);
}

describe("createScheduleContext — cross-tick cache", () => {
  it("resolves a trip's schedule from the repo only once across ticks", () => {
    const repos = seed();
    const cache = createScheduleCache();
    const metaSpy = vi.spyOn(repos.gtfs, "tripMeta");
    const stopTimesSpy = vi.spyOn(repos.gtfs, "stopTimesForTrip");
    const stopNameSpy = vi.spyOn(repos.gtfs, "stopName");

    // Tick 1: a fresh context sharing the cache resolves and caches.
    const ctx1 = createScheduleContext(repos.gtfs, cache);
    expect(ctx1.lookup("T1", DATE)?.routeId).toBe("NE");
    expect(ctx1.stopName("NWK")).toBe("Newark Penn");

    // Tick 2: a new context on the same (unchanged) version hits the cache.
    const ctx2 = createScheduleContext(repos.gtfs, cache);
    expect(ctx2.lookup("T1", DATE)?.routeId).toBe("NE");
    expect(ctx2.stopName("NWK")).toBe("Newark Penn");

    expect(metaSpy).toHaveBeenCalledTimes(1);
    expect(stopTimesSpy).toHaveBeenCalledTimes(1);
    expect(stopNameSpy).toHaveBeenCalledTimes(1);
  });

  it("memoizes unmatched trips so they aren't re-resolved every tick", () => {
    const repos = seed();
    const cache = createScheduleCache();
    const metaSpy = vi.spyOn(repos.gtfs, "tripMeta");

    createScheduleContext(repos.gtfs, cache).lookup("MISSING", DATE);
    createScheduleContext(repos.gtfs, cache).lookup("MISSING", DATE);

    expect(metaSpy).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache when the GTFS version rolls over", () => {
    const repos = seed();
    const cache = createScheduleCache();
    const metaSpy = vi.spyOn(repos.gtfs, "tripMeta");

    createScheduleContext(repos.gtfs, cache).lookup("T1", DATE);
    expect(metaSpy).toHaveBeenCalledTimes(1);

    // A newer version becomes current (higher effective_from) → cache cleared.
    seedVersion(repos, "v2", 1000);
    createScheduleContext(repos.gtfs, cache).lookup("T1", DATE);
    expect(metaSpy).toHaveBeenCalledTimes(2);
  });
});
