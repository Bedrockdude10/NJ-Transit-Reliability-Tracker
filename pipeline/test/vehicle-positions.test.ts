import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { parseVehiclePositions, type ScheduleContext } from "../src/gtfs-rt/parse";

const { transit_realtime: tr } = GtfsRealtimeBindings;

function encode(entities: unknown[]): Uint8Array {
  return tr.FeedMessage.encode({ header: { gtfsRealtimeVersion: "2.0" }, entity: entities as never }).finish();
}

const ctx: ScheduleContext = {
  lookup: (tripId) =>
    tripId === "T1"
      ? { routeId: "NE", lineName: "Northeast Corridor Line", direction: "inbound", stops: [] }
      : null,
  stopName: (s) => (s === "NWK" ? "Newark Penn" : s),
  // Source id "10" collapses onto canonical NJCL, as GTFS ingest maps it.
  resolveRoute: (routeId) => (routeId === "10" ? { routeId: "NC", lineName: "North Jersey Coast Line" } : null),
};

const opts = { now: 1_700_000_000_000, defaultServiceDate: "2026-07-15" };

describe("parseVehiclePositions", () => {
  it("returns an empty list for an empty feed body", () => {
    expect(parseVehiclePositions(new Uint8Array(), ctx, opts)).toEqual([]);
  });

  it("decodes position, speed, bearing, status and stop name", () => {
    const buffer = encode([
      {
        id: "e1",
        vehicle: {
          vehicle: { id: "V1" },
          trip: { tripId: "T1", routeId: "NE", startDate: "20260715", directionId: 1 },
          position: { latitude: 40.7, longitude: -74.16, bearing: 90, speed: 20 },
          stopId: "NWK",
          currentStatus: 1, // STOPPED_AT
          timestamp: 1_700_000_000,
        },
      },
    ]);
    const [v] = parseVehiclePositions(buffer, ctx, opts);
    expect(v).toMatchObject({
      vehicleId: "V1",
      tripId: "T1",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      direction: "inbound",
      stopId: "NWK",
      stopName: "Newark Penn",
      status: "stopped_at",
      reportedAt: 1_700_000_000,
      ingestedAtMs: opts.now,
    });
    expect(v?.speedMetersPerSecond).toBe(20);
    expect(v?.bearing).toBe(90);
    // GTFS-RT carries lat/lon as float32, so they round-trip to ~1m, not exactly.
    expect(v?.latitude).toBeCloseTo(40.7, 5);
    expect(v?.longitude).toBeCloseTo(-74.16, 5);
  });

  it("resolves a source route id when the trip is missing from the static schedule", () => {
    const buffer = encode([
      {
        id: "e2",
        vehicle: {
          vehicle: { id: "V2" },
          trip: { tripId: "UNKNOWN", routeId: "10", startDate: "20260715" },
          position: { latitude: 40.42, longitude: -74.22 },
        },
      },
    ]);
    const [v] = parseVehiclePositions(buffer, ctx, opts);
    expect(v).toMatchObject({ routeId: "NC", lineName: "North Jersey Coast Line" });
  });

  it("drops vehicles with no usable position rather than mapping them to null island", () => {
    const buffer = encode([
      { id: "no-pos", vehicle: { vehicle: { id: "V3" }, trip: { tripId: "T1" } } },
      {
        id: "zero-zero",
        vehicle: { vehicle: { id: "V4" }, trip: { tripId: "T1" }, position: { latitude: 0, longitude: 0 } },
      },
      {
        id: "ok",
        vehicle: { vehicle: { id: "V5" }, trip: { tripId: "T1" }, position: { latitude: 40.7, longitude: -74.1 } },
      },
    ]);
    expect(parseVehiclePositions(buffer, ctx, opts).map((v) => v.vehicleId)).toEqual(["V5"]);
  });

  it("falls back to the entity id when the feed omits vehicle.id", () => {
    const buffer = encode([
      { id: "entity-7", vehicle: { trip: { tripId: "T1" }, position: { latitude: 40.7, longitude: -74.1 } } },
      { id: "entity-8", vehicle: { trip: { tripId: "T1" }, position: { latitude: 40.8, longitude: -74.2 } } },
    ]);
    // Distinct rows, not one row that overwrites itself on the primary key.
    expect(parseVehiclePositions(buffer, ctx, opts).map((v) => v.vehicleId)).toEqual(["entity-7", "entity-8"]);
  });
});
