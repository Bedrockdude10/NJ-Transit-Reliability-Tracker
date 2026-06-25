import type { TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const SCHEDULED = 1000; // epoch seconds
const SCHEDULED_MS = SCHEDULED * 1000;

function baseEvent(overrides: Partial<TripStopEvent> = {}): TripStopEvent {
  return {
    tripId: "T1",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "S1",
    stopName: "Newark",
    stopSequence: 5,
    direction: "inbound",
    serviceDate: "2025-07-15",
    scheduledArrival: SCHEDULED,
    scheduledDeparture: SCHEDULED + 30,
    observedArrival: SCHEDULED + 300,
    delaySeconds: 300,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: SCHEDULED_MS + 600_000,
    ...overrides,
  };
}

function stored(repos: Repositories): TripStopEvent {
  const found = repos.events.getByServiceDate("2025-07-15").find((e) => e.tripId === "T1" && e.stopId === "S1");
  if (!found) throw new Error("event not found");
  return found;
}

describe("TripStopEventRepository dedup", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("keeps the reading closest to the scheduled arrival", () => {
    repos.events.record(baseEvent({ delaySeconds: 300, ingestedAtMs: SCHEDULED_MS + 600_000 }));
    repos.events.record(baseEvent({ delaySeconds: 120, ingestedAtMs: SCHEDULED_MS + 60_000 }));
    expect(stored(repos).delaySeconds).toBe(120);
  });

  it("does not let a farther reading overwrite a closer one", () => {
    repos.events.record(baseEvent({ delaySeconds: 120, ingestedAtMs: SCHEDULED_MS + 60_000 }));
    repos.events.record(baseEvent({ delaySeconds: 999, ingestedAtMs: SCHEDULED_MS + 900_000 }));
    expect(stored(repos).delaySeconds).toBe(120);
  });

  it("lets a cancellation override regardless of timing", () => {
    repos.events.record(baseEvent({ delaySeconds: 120, ingestedAtMs: SCHEDULED_MS + 60_000 }));
    repos.events.record(
      baseEvent({ tripCancelled: true, delaySeconds: null, ingestedAtMs: SCHEDULED_MS + 900_000 }),
    );
    expect(stored(repos).tripCancelled).toBe(true);
  });

  it("round-trips booleans and nullable fields", () => {
    repos.events.record(baseEvent({ stopSkipped: true, observedArrival: null, delaySeconds: null }));
    const e = stored(repos);
    expect(e.stopSkipped).toBe(true);
    expect(e.observedArrival).toBeNull();
    expect(e.delaySeconds).toBeNull();
  });
});
