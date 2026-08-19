import type { GtfsStaticVersion } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const VERSION: GtfsStaticVersion = {
  versionId: "v1",
  effectiveFrom: 1_700_000_000,
  effectiveTo: null,
  checksum: "abc123",
  ingestedAtMs: 1_700_000_000_000,
};

describe("GtfsRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    repos.gtfs.insertVersion(VERSION);
    repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
    repos.gtfs.replaceStops("v1", [
      { stopId: "NWK", stopName: "Newark Penn" },
      { stopId: "NYP", stopName: "New York Penn" },
    ]);
    repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 0 }]);
    repos.gtfs.replaceStopTimes("v1", [
      { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
      { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "08:20:00", departureTime: "08:21:00" },
    ]);
  });

  it("returns the current version and resolves lookups", () => {
    expect(repos.gtfs.currentVersion()?.versionId).toBe("v1");
    expect(repos.gtfs.findByChecksum("abc123")?.versionId).toBe("v1");
    expect(repos.gtfs.lineNameForRoute("v1", "NE")).toBe("Northeast Corridor Line");
    expect(repos.gtfs.stopName("v1", "NYP")).toBe("New York Penn");
  });

  it("lists stations with the lines that serve them", () => {
    const stations = repos.gtfs.stationsWithLines("v1");
    expect(stations).toHaveLength(2);
    const nwk = stations.find((s) => s.stopId === "NWK");
    expect(nwk?.stopName).toBe("Newark Penn");
    expect(nwk?.lines).toEqual(["NE"]);
  });

  it("returns ordered stop times for a trip", () => {
    const times = repos.gtfs.stopTimesForTrip("v1", "T1");
    expect(times.map((t) => t.stopId)).toEqual(["NWK", "NYP"]);
    expect(times[1]?.arrivalTime).toBe("08:20:00");
  });

  describe("arrivalTimesForTrips", () => {
    it("looks up a whole service day of trips in one query", () => {
      // A busy day runs ~780 trips, and the lookup binds one parameter per trip;
      // SQLite rejects the statement outright past its variable limit.
      const trips = Array.from({ length: 1500 }, (_, i) => `T${i}`);
      repos.gtfs.insertVersion({
        versionId: "big",
        effectiveFrom: 0,
        effectiveTo: null,
        checksum: "c",
        ingestedAtMs: 0,
      });
      repos.gtfs.replaceStopTimes(
        "big",
        trips.map((tripId) => ({
          tripId,
          stopId: "S1",
          stopSequence: 1,
          arrivalTime: "07:15:00",
          departureTime: null,
        })),
      );

      const found = repos.gtfs.arrivalTimesForTrips("big", trips);
      expect(found.size).toBe(1500);
      expect(found.get("T900|S1")).toBe("07:15:00");
    });

    it("returns nothing rather than a broken query when asked for no trips", () => {
      expect(repos.gtfs.arrivalTimesForTrips("v1", []).size).toBe(0);
    });
  });
});
