import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { CommuteResponse, TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app";

const DATE = "2026-08-13";
const base = Date.parse(`${DATE}T11:00:00Z`) / 1000;

function stop(overrides: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "T1",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "A",
    stopName: "Newark Penn",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: DATE,
    scheduledArrival: base,
    scheduledDeparture: base,
    observedArrival: base,
    delaySeconds: 0,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: Date.now(),
    ...overrides,
  };
}

describe("GET /commute", () => {
  let app: Hono;
  let repos: Repositories;

  beforeEach(() => {
    repos = createRepositories(openDatabase());
    repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
    repos.gtfs.replaceStops("v1", [
      { stopId: "A", stopName: "Newark Penn", stopLat: 40.73, stopLon: -74.16 },
      { stopId: "B", stopName: "New York Penn", stopLat: 40.75, stopLon: -73.99 },
    ]);
    app = createApp(repos);
  });

  const ask = async (q: string) => {
    const res = await app.request(`/commute?${q}&from=${DATE}&to=${DATE}`);
    return { res, body: (await res.json()) as CommuteResponse };
  };

  it("requires both ends, and rejects a journey to the same station", async () => {
    expect((await app.request("/commute")).status).toBe(400);
    expect((await app.request("/commute?origin=A")).status).toBe(400);
    expect((await app.request("/commute?origin=A&destination=A")).status).toBe(400);
  });

  it("pairs the same trip's two stops into a journey", async () => {
    repos.events.record(stop({ stopId: "A", stopSequence: 1, scheduledDeparture: base }));
    repos.events.record(stop({ stopId: "B", stopSequence: 5, scheduledArrival: base + 2400, observedArrival: base + 2700, delaySeconds: 300 }));

    const { body } = await ask("origin=A&destination=B");
    expect(body.observations).toBe(1);
    expect(body.origin.stopName).toBe("Newark Penn");
    expect(body.destination.stopName).toBe("New York Penn");
    expect(body.linesServing).toEqual(["Northeast Corridor Line"]);
    // 300s late is exactly the strict threshold, so still on time.
    expect(body.onTimePercent).toBe(100);
    expect(body.scheduledJourneyMinutes).toBe(40);
    expect(body.medianJourneyMinutes).toBe(45);
  });

  // Direction is the whole point: A→B and B→A are different trains.
  it("does not return the reverse journey", async () => {
    repos.events.record(stop({ stopId: "A", stopSequence: 1 }));
    repos.events.record(stop({ stopId: "B", stopSequence: 5 }));

    expect((await ask("origin=A&destination=B")).body.observations).toBe(1);
    expect((await ask("origin=B&destination=A")).body.observations).toBe(0);
  });

  it("returns an empty answer, not an error, for two unconnected stations", async () => {
    const { res, body } = await ask("origin=A&destination=B");
    expect(res.status).toBe(200);
    expect(body.observations).toBe(0);
    expect(body.linesServing).toEqual([]);
    expect(body.departures).toEqual([]);
  });

  it("counts a cancelled journey without letting it distort the delay stats", async () => {
    repos.events.record(stop({ stopId: "A", stopSequence: 1, tripCancelled: true, observedArrival: null, delaySeconds: null }));
    repos.events.record(stop({ stopId: "B", stopSequence: 5, tripCancelled: true, observedArrival: null, delaySeconds: null }));
    repos.events.record(stop({ tripId: "T2", stopId: "A", stopSequence: 1 }));
    repos.events.record(stop({ tripId: "T2", stopId: "B", stopSequence: 5, delaySeconds: 0 }));

    const { body } = await ask("origin=A&destination=B");
    expect(body.observations).toBe(2);
    expect(body.cancellations).toBe(1);
    expect(body.cancellationRatePercent).toBe(50);
    expect(body.onTimePercent).toBe(100); // from the one journey that ran
  });

  it("ignores a trip that calls at only one of the two stations", async () => {
    repos.events.record(stop({ stopId: "A", stopSequence: 1 }));
    const { body } = await ask("origin=A&destination=B");
    expect(body.observations).toBe(0);
  });
});
