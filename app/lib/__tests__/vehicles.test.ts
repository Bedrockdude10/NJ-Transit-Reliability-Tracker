import type { MapVehicle } from "@njt/shared";
import { describe, expect, it } from "vitest";
import { isVehicleStale, splitLiveVehicles, staleVehicleNote, VEHICLE_STALE_AFTER_SECONDS } from "../vehicles";

function vehicle(ageSeconds: number | null, id = "v"): MapVehicle {
  return {
    vehicleId: id,
    tripId: null,
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    direction: "inbound",
    latitude: 40.7,
    longitude: -74.1,
    bearing: 90,
    speedMph: 40,
    stopId: null,
    stopName: null,
    status: "in_transit_to",
    reportedAt: 1,
    ageSeconds,
  };
}

describe("isVehicleStale", () => {
  it("keeps a recent position", () => {
    expect(isVehicleStale(vehicle(0))).toBe(false);
    expect(isVehicleStale(vehicle(VEHICLE_STALE_AFTER_SECONDS))).toBe(false);
  });

  // Production has served positions nearly eight hours old; drawing those puts
  // phantom trains on the map.
  it("rejects a position past the freshness window", () => {
    expect(isVehicleStale(vehicle(VEHICLE_STALE_AFTER_SECONDS + 1))).toBe(true);
    expect(isVehicleStale(vehicle(27_935))).toBe(true);
  });

  it("treats a missing timestamp as untrustworthy rather than fresh", () => {
    expect(isVehicleStale(vehicle(null))).toBe(true);
  });
});

describe("splitLiveVehicles", () => {
  it("separates drawable trains from a count of what was withheld", () => {
    const result = splitLiveVehicles([vehicle(10, "a"), vehicle(99_999, "b"), vehicle(null, "c"), vehicle(30, "d")]);
    expect(result.live.map((v) => v.vehicleId)).toEqual(["a", "d"]);
    expect(result.hiddenStale).toBe(2);
  });

  it("handles the pre-load state", () => {
    expect(splitLiveVehicles(undefined)).toEqual({ live: [], hiddenStale: 0 });
    expect(splitLiveVehicles([])).toEqual({ live: [], hiddenStale: 0 });
  });
});

describe("staleVehicleNote", () => {
  it("says nothing when nothing was hidden", () => {
    expect(staleVehicleNote(0)).toBeNull();
  });

  it("discloses what was withheld, rather than dropping it silently", () => {
    expect(staleVehicleNote(1)).toContain("1 train hidden");
    expect(staleVehicleNote(4)).toContain("4 trains hidden");
    expect(staleVehicleNote(4)).toContain("5 minutes");
  });
});
