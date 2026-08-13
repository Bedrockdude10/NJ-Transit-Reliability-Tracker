import type { VehiclePosition } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src";

function position(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    vehicleId: "V1",
    tripId: "T1",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    direction: "inbound",
    latitude: 40.7,
    longitude: -74.16,
    bearing: 90,
    speedMetersPerSecond: 20,
    stopId: "NWK",
    stopName: "Newark Penn",
    status: "stopped_at",
    reportedAt: 1_700_000_000,
    ingestedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("VehiclePositionRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("round-trips a position with every optional field set", () => {
    repos.vehicles.replaceAll([position()]);
    expect(repos.vehicles.all()).toEqual([position()]);
  });

  it("round-trips a position with every optional field null", () => {
    const sparse = position({
      vehicleId: "V9",
      tripId: null,
      routeId: null,
      lineName: null,
      direction: null,
      bearing: null,
      speedMetersPerSecond: null,
      stopId: null,
      stopName: null,
      status: null,
      reportedAt: null,
    });
    repos.vehicles.replaceAll([sparse]);
    expect(repos.vehicles.all()).toEqual([sparse]);
  });

  // The feed is a complete snapshot each poll, so a train that stops reporting
  // must disappear rather than linger at a stale position.
  it("replaces the whole snapshot rather than accumulating", () => {
    repos.vehicles.replaceAll([position({ vehicleId: "V1" }), position({ vehicleId: "V2" })]);
    expect(repos.vehicles.count()).toBe(2);

    repos.vehicles.replaceAll([position({ vehicleId: "V2" })]);
    expect(repos.vehicles.all().map((v) => v.vehicleId)).toEqual(["V2"]);
  });

  it("filters by canonical route id", () => {
    repos.vehicles.replaceAll([
      position({ vehicleId: "V1", routeId: "NE" }),
      position({ vehicleId: "V2", routeId: "NC" }),
    ]);
    expect(repos.vehicles.all("NC").map((v) => v.vehicleId)).toEqual(["V2"]);
    expect(repos.vehicles.all().length).toBe(2);
  });

  it("handles an empty snapshot", () => {
    repos.vehicles.replaceAll([position()]);
    repos.vehicles.replaceAll([]);
    expect(repos.vehicles.all()).toEqual([]);
    expect(repos.vehicles.count()).toBe(0);
  });
});
