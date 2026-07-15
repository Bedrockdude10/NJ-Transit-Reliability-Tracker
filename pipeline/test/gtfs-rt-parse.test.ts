import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it, vi } from "vitest";
import { parseServiceAlerts, parseTripUpdates, type ScheduleContext } from "../src/gtfs-rt/parse";

const { transit_realtime: tr } = GtfsRealtimeBindings;
const CANCELED = tr.TripDescriptor.ScheduleRelationship.CANCELED;

function encode(entities: unknown[]): Uint8Array {
  return tr.FeedMessage.encode({ header: { gtfsRealtimeVersion: "2.0" }, entity: entities as never }).finish();
}

const STOP_NAMES: Record<string, string> = { NWK: "Newark Penn", NYP: "New York Penn" };

const ctx: ScheduleContext = {
  lookup: (tripId) =>
    tripId === "T1"
      ? {
          routeId: "NE",
          lineName: "Northeast Corridor Line",
          direction: "inbound",
          stops: [
            { stopId: "NWK", stopSequence: 1, scheduledArrival: 1000, scheduledDeparture: 1060 },
            { stopId: "NYP", stopSequence: 2, scheduledArrival: 2000, scheduledDeparture: null },
          ],
        }
      : null,
  stopName: (s) => STOP_NAMES[s] ?? s,
};

const opts = { now: 5_000_000, defaultServiceDate: "2025-07-15", gtfsStaticVersion: "v1" };

describe("parseTripUpdates", () => {
  it("computes delay and metadata from the static schedule", () => {
    const buffer = encode([
      {
        id: "1",
        tripUpdate: {
          trip: { tripId: "T1", routeId: "NE", startDate: "20250715", directionId: 1 },
          stopTimeUpdate: [
            { stopId: "NWK", stopSequence: 1, arrival: { time: 1120, delay: 120 } },
            { stopId: "NYP", stopSequence: 2, arrival: { time: 2200, delay: 200 } },
          ],
        },
      },
    ]);
    const events = parseTripUpdates(buffer, ctx, opts);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      tripId: "T1",
      stopId: "NWK",
      stopName: "Newark Penn",
      lineName: "Northeast Corridor Line",
      direction: "inbound",
      serviceDate: "2025-07-15",
      scheduledArrival: 1000,
      observedArrival: 1120,
      delaySeconds: 120,
      tripCancelled: false,
    });
    expect(events[1]?.delaySeconds).toBe(200);
  });

  it("derives scheduled time from observed minus delay when the trip is unmatched", () => {
    const onTripMismatch = vi.fn();
    const buffer = encode([
      {
        id: "2",
        tripUpdate: {
          trip: { tripId: "T9", routeId: "RV", startDate: "20250715", directionId: 0 },
          stopTimeUpdate: [{ stopId: "ZZZ", stopSequence: 1, arrival: { time: 500, delay: 60 } }],
        },
      },
    ]);
    const events = parseTripUpdates(buffer, ctx, { ...opts, onTripMismatch });
    expect(onTripMismatch).toHaveBeenCalledWith("T9");
    expect(events[0]).toMatchObject({ scheduledArrival: 440, observedArrival: 500, delaySeconds: 60, direction: "outbound", lineName: "RV" });
  });

  it("emits cancelled events for every scheduled stop of a cancelled trip", () => {
    const buffer = encode([
      { id: "3", tripUpdate: { trip: { tripId: "T1", startDate: "20250715", scheduleRelationship: CANCELED } } },
    ]);
    const events = parseTripUpdates(buffer, ctx, opts);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.tripCancelled)).toBe(true);
    expect(events.map((e) => e.stopId)).toEqual(["NWK", "NYP"]);
  });

  it("returns no events for an empty body (NJT sends 200 + 0 bytes)", () => {
    expect(parseTripUpdates(new Uint8Array(), ctx, opts)).toEqual([]);
  });
});

describe("parseServiceAlerts", () => {
  it("returns no alerts for an empty body", () => {
    expect(parseServiceAlerts(new Uint8Array(), { now: 0 })).toEqual([]);
  });

  it("maps effect, routes, stops, and translated text", () => {
    const buffer = encode([
      {
        id: "alert-1",
        alert: {
          effect: tr.Alert.Effect.SIGNIFICANT_DELAYS,
          informedEntity: [{ routeId: "NE", stopId: "NWK" }, { routeId: "NE" }],
          headerText: { translation: [{ text: "NEC delays", language: "en" }] },
          descriptionText: { translation: [{ text: "Signal trouble", language: "en" }] },
          activePeriod: [{ start: 1_700_000_000 }],
        },
      },
    ]);
    const alerts = parseServiceAlerts(buffer, { now: 5_000_000 });
    expect(alerts[0]).toMatchObject({
      alertId: "alert-1",
      effectType: "delay",
      affectedRoutes: ["NE"],
      affectedStops: ["NWK"],
      headerText: "NEC delays",
      activeFrom: 1_700_000_000,
      ingestedAtMs: 5_000_000,
    });
  });
});
