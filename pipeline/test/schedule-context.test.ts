import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { gtfsStopTimeToEpochSeconds } from "@njt/shared";
import { describe, expect, it } from "vitest";
import { directionFromId } from "../src/gtfs-rt/parse";
import { createScheduleContext } from "../src/gtfs-rt/schedule-context";

const DATE = "2025-07-15";

// A tiny GTFS version whose last stop time crosses midnight (>24:00:00), which
// GTFS uses to keep a trip anchored to its (previous) service date.
function seedGtfs(): Repositories {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
  repos.gtfs.replaceStops("v1", [
    { stopId: "NWK", stopName: "Newark Penn" },
    { stopId: "NYP", stopName: "New York Penn" },
  ]);
  repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
  repos.gtfs.replaceStopTimes("v1", [
    { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "23:50:00", departureTime: "23:51:00" },
    { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "25:10:00", departureTime: "25:11:00" },
  ]);
  return repos;
}

describe("createScheduleContext", () => {
  it("resolves absolute epoch seconds for normal and >24:00:00 stop times", () => {
    const repos = seedGtfs();
    const ctx = createScheduleContext(repos.gtfs);

    const schedule = ctx.lookup("T1", DATE);
    expect(schedule).not.toBeNull();
    expect(schedule?.routeId).toBe("NE");
    expect(schedule?.lineName).toBe("Northeast Corridor Line");
    expect(schedule?.direction).toBe(directionFromId(1)); // "inbound"

    const [first, second] = schedule!.stops;
    expect(first?.scheduledArrival).toBe(gtfsStopTimeToEpochSeconds(DATE, "23:50:00"));
    expect(first?.scheduledDeparture).toBe(gtfsStopTimeToEpochSeconds(DATE, "23:51:00"));

    // 25:10:00 is a valid GTFS time past midnight; it must resolve to an
    // absolute instant 80 minutes after the 23:50 arrival, not wrap negatively.
    expect(second?.scheduledArrival).toBe(gtfsStopTimeToEpochSeconds(DATE, "25:10:00"));
    expect(second!.scheduledArrival! - first!.scheduledArrival!).toBe(80 * 60);
  });

  it("returns null for an unknown trip", () => {
    const repos = seedGtfs();
    const ctx = createScheduleContext(repos.gtfs);
    expect(ctx.lookup("does-not-exist", DATE)).toBeNull();
  });

  it("returns null when no current GTFS version exists", () => {
    const repos = createRepositories(openDatabase());
    const ctx = createScheduleContext(repos.gtfs);
    expect(ctx.lookup("T1", DATE)).toBeNull();
    // stopName falls back to the raw id with no version.
    expect(ctx.stopName("NWK")).toBe("NWK");
  });
});
