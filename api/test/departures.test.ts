import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { StationDeparturesResponse, TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app";

/**
 * The route reads the clock per request, so offsets are re-derived per test and
 * deliberately parked mid-minute (+30s). A departure exactly 300s out would
 * flip between "5 min" and "4 min" depending on how long the suite took to get
 * here — the padding makes the countdown assertions insensitive to that drift.
 */
let NOW_SEC = Math.floor(Date.now() / 1000);
/** `minutes` from now, offset to sit half a minute from any boundary. */
const inMinutes = (minutes: number) => NOW_SEC + minutes * 60 + 30;

function event(overrides: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "T1",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "NWK",
    stopName: "Newark Penn",
    stopSequence: 3,
    direction: "inbound",
    serviceDate: "2026-08-13",
    scheduledArrival: inMinutes(10),
    scheduledDeparture: inMinutes(10),
    observedArrival: inMinutes(10),
    delaySeconds: 0,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: Date.now(),
    ...overrides,
  };
}

describe("GET /stations/:stopId/departures", () => {
  let app: Hono;
  let repos: Repositories;

  beforeEach(() => {
    NOW_SEC = Math.floor(Date.now() / 1000);
    repos = createRepositories(openDatabase());
    repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
    repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
    repos.gtfs.replaceStops("v1", [{ stopId: "NWK", stopName: "Newark Penn", stopLat: 40.73, stopLon: -74.16 }]);
    repos.gtfs.replaceTrips("v1", [
      { tripId: "T1", routeId: "NE", directionId: 1, tripHeadsign: "New York Penn" },
      { tripId: "T2", routeId: "NE", directionId: 1, tripHeadsign: "Trenton" },
    ]);
    app = createApp(repos);
  });

  const board = async (query = "") => {
    const res = await app.request(`/stations/NWK/departures${query}`);
    return { res, body: (await res.json()) as StationDeparturesResponse };
  };

  it("lists upcoming trains with destination, soonest first", async () => {
    repos.events.record(event({ tripId: "T2", scheduledDeparture: inMinutes(30), observedArrival: inMinutes(30) }));
    repos.events.record(event({ tripId: "T1", scheduledDeparture: inMinutes(5), observedArrival: inMinutes(5) }));

    const { res, body } = await board();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body.stopName).toBe("Newark Penn");
    expect(body.departures.map((d) => d.tripId)).toEqual(["T1", "T2"]);
    expect(body.departures[0]?.destination).toBe("New York Penn");
    expect(body.departures[0]?.minutesAway).toBe(5);
  });

  it("classifies late, on-time and untracked trains differently", async () => {
    repos.events.record(event({ tripId: "T1", observedArrival: inMinutes(5), delaySeconds: 0 }));
    repos.events.record(event({ tripId: "T2", observedArrival: inMinutes(6), delaySeconds: 900 }));
    repos.events.record(
      event({ tripId: "T3", stopSequence: 5, observedArrival: null, delaySeconds: null, scheduledDeparture: inMinutes(8) }),
    );

    const { body } = await board();
    const byTrip = Object.fromEntries(body.departures.map((d) => [d.tripId, d.status]));
    expect(byTrip).toMatchObject({ T1: "on_time", T2: "late", T3: "scheduled" });
  });

  // A cancelled train must stay on the board — that is the information a rider
  // most needs, and dropping it would silently look like a normal gap.
  it("keeps a cancelled train on the board in its scheduled slot", async () => {
    repos.events.record(
      event({ tripId: "T2", tripCancelled: true, observedArrival: null, delaySeconds: null, scheduledDeparture: inMinutes(5) }),
    );

    const { body } = await board();
    expect(body.departures).toHaveLength(1);
    expect(body.departures[0]).toMatchObject({ status: "cancelled", predictedTime: null, delaySeconds: null });
    // Still positioned by its timetabled slot.
    expect(body.departures[0]?.minutesAway).toBe(5);
  });

  it("excludes trains beyond the horizon and honours a custom one", async () => {
    repos.events.record(event({ tripId: "T1", observedArrival: inMinutes(5) }));
    repos.events.record(event({ tripId: "T2", observedArrival: inMinutes(180) }));

    expect((await board()).body.departures.map((d) => d.tripId)).toEqual(["T1"]);
    const wide = await board("?horizonMinutes=240");
    expect(wide.body.departures.map((d) => d.tripId)).toEqual(["T1", "T2"]);
    expect(wide.body.horizonMinutes).toBe(240);
  });

  it("clamps an absurd horizon rather than scanning everything", async () => {
    expect((await board("?horizonMinutes=99999")).body.horizonMinutes).toBe(720);
    expect((await board("?horizonMinutes=1")).body.horizonMinutes).toBe(5);
    expect((await board("?horizonMinutes=nonsense")).body.horizonMinutes).toBe(90);
  });

  it("returns an empty board rather than an error when nothing is due", async () => {
    const { res, body } = await board();
    expect(res.status).toBe(200);
    expect(body.departures).toEqual([]);
  });

  it("still shows a train that departed moments ago", async () => {
    // 30s ago: inside the grace window, and `minutesUntil` floors to -1 with
    // plenty of room before drift would tip it to -2.
    repos.events.record(event({ tripId: "T1", observedArrival: NOW_SEC - 30, scheduledDeparture: NOW_SEC - 30 }));
    const { body } = await board();
    expect(body.departures).toHaveLength(1);
    expect(body.departures[0]?.minutesAway).toBe(-1);
  });

  it("drops a train that departed long enough ago to be irrelevant", async () => {
    repos.events.record(event({ tripId: "T1", observedArrival: NOW_SEC - 600, scheduledDeparture: NOW_SEC - 600 }));
    expect((await board()).body.departures).toEqual([]);
  });
});
