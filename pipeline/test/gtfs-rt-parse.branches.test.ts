import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { directionFromId, parseServiceAlerts, parseTripUpdates, type ScheduleContext } from "../src/gtfs-rt/parse";

const { transit_realtime: tr } = GtfsRealtimeBindings;
const CANCELED = tr.TripDescriptor.ScheduleRelationship.CANCELED;
const SKIPPED = tr.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;

function encode(entities: unknown[]): Uint8Array {
  return tr.FeedMessage.encode({ header: { gtfsRealtimeVersion: "2.0" }, entity: entities as never }).finish();
}

// A context that never matches a trip, forcing the RT-only derivation paths.
const emptyCtx: ScheduleContext = { lookup: () => null, stopName: (s) => s };

const opts = { now: 5_000_000, defaultServiceDate: "2025-07-15", gtfsStaticVersion: "v1" };

describe("directionFromId", () => {
  it("maps 1 to inbound and everything else to outbound", () => {
    expect(directionFromId(1)).toBe("inbound");
    expect(directionFromId(0)).toBe("outbound");
    expect(directionFromId(null)).toBe("outbound");
    expect(directionFromId(undefined)).toBe("outbound");
  });
});

describe("parseTripUpdates — branch coverage", () => {
  it("falls back to the default service date when start_date is absent or malformed", () => {
    const buffer = encode([
      {
        id: "1",
        tripUpdate: {
          trip: { tripId: "T9", routeId: "RV", directionId: 0 }, // no startDate
          stopTimeUpdate: [{ stopId: "AAA", stopSequence: 1, arrival: { time: 100, delay: 10 } }],
        },
      },
      {
        id: "2",
        tripUpdate: {
          trip: { tripId: "T8", routeId: "RV", startDate: "not-a-date", directionId: 0 },
          stopTimeUpdate: [{ stopId: "BBB", stopSequence: 1, arrival: { time: 100, delay: 10 } }],
        },
      },
    ]);
    const events = parseTripUpdates(buffer, emptyCtx, opts);
    expect(events.every((e) => e.serviceDate === "2025-07-15")).toBe(true);
  });

  it("skips entities that carry no trip update", () => {
    // A bare entity (no tripUpdate at all) → `!tu?.trip` short-circuits.
    const buffer = encode([{ id: "x" }, { id: "y" }]);
    expect(parseTripUpdates(buffer, emptyCtx, opts)).toEqual([]);
  });

  it("emits no events for a cancelled trip that has no matched schedule", () => {
    // cancelled && !schedule → the cancelled branch is skipped and there are no
    // stopTimeUpdates to iterate, so nothing is emitted.
    const buffer = encode([
      { id: "c", tripUpdate: { trip: { tripId: "GHOST", startDate: "20250715", scheduleRelationship: CANCELED } } },
    ]);
    expect(parseTripUpdates(buffer, emptyCtx, opts)).toEqual([]);
  });

  it("marks a stop skipped and derives nulls when arrival data is missing", () => {
    const buffer = encode([
      {
        id: "s",
        tripUpdate: {
          trip: { tripId: "T7", routeId: "RV", startDate: "20250715", directionId: 0 },
          stopTimeUpdate: [
            { stopId: "SKIP", stopSequence: 3, scheduleRelationship: SKIPPED },
            { stopId: "NOARR", stopSequence: 4 }, // no arrival at all
          ],
        },
      },
    ]);
    const events = parseTripUpdates(buffer, emptyCtx, opts);
    const skip = events.find((e) => e.stopId === "SKIP");
    const noArr = events.find((e) => e.stopId === "NOARR");
    expect(skip?.stopSkipped).toBe(true);
    expect(noArr).toMatchObject({ scheduledArrival: null, observedArrival: null, delaySeconds: null, stopSequence: 4 });
  });

  it("defaults stopId and stopSequence when the update omits them", () => {
    const buffer = encode([
      {
        id: "d",
        tripUpdate: {
          trip: { tripId: "T6", routeId: "RV", startDate: "20250715" },
          stopTimeUpdate: [{ arrival: { time: 200, delay: 20 } }], // no stopId / stopSequence
        },
      },
    ]);
    const events = parseTripUpdates(buffer, emptyCtx, opts);
    expect(events[0]).toMatchObject({ stopId: "", stopSequence: 0, observedArrival: 200, delaySeconds: 20 });
  });

  it("uses the schedule's scheduled time and carries the reported delay for a matched stop", () => {
    // The schedule supplies scheduledArrival (left side of the `??`); protobuf
    // defaults an omitted `delay` to 0, so delaySeconds is the reported 0.
    const ctx: ScheduleContext = {
      lookup: () => ({
        routeId: "NE",
        lineName: "Northeast Corridor Line",
        direction: "inbound",
        stops: [{ stopId: "NWK", stopSequence: 1, scheduledArrival: 1000, scheduledDeparture: 1050 }],
      }),
      stopName: (s) => s,
    };
    const buffer = encode([
      {
        id: "e",
        tripUpdate: {
          trip: { tripId: "T1", startDate: "20250715", directionId: 1 },
          stopTimeUpdate: [{ stopId: "NWK", stopSequence: 1, arrival: { time: 1200 } }],
        },
      },
    ]);
    const events = parseTripUpdates(buffer, ctx, opts);
    expect(events[0]).toMatchObject({
      scheduledArrival: 1000,
      scheduledDeparture: 1050,
      observedArrival: 1200,
      delaySeconds: 0,
    });
  });
});

describe("parseServiceAlerts — branch coverage", () => {
  it("skips entities without an alert and handles missing text / period / effect", () => {
    const buffer = encode([
      { id: "not-alert" }, // bare entity, no alert → skipped
      {
        id: "bare",
        alert: {}, // no effect, no informedEntity, no text, no activePeriod
      },
    ]);
    const alerts = parseServiceAlerts(buffer, { now: 42 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      alertId: "bare",
      affectedRoutes: [],
      affectedStops: [],
      headerText: "",
      descriptionText: "",
      effectType: "unknown", // effect defaulted to 8 → unknown
      activeFrom: null,
      activeTo: null,
      ingestedAtMs: 42,
    });
  });

  it("maps a numeric effect enum through EFFECT_MAP", () => {
    const buffer = encode([
      { id: "a", alert: { effect: tr.Alert.Effect.DETOUR, informedEntity: [{ routeId: "NE" }] } },
    ]);
    expect(parseServiceAlerts(buffer, { now: 0 })[0]?.effectType).toBe("detour");
  });
});
