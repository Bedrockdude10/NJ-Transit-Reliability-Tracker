import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { trainRecordResponseSchema, type TripStopEvent } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * `GET /trips/:tripId/record` — one departure's own history. See README
 * "Train record".
 */

const NEC = "Northeast Corridor Line";
/** 2026-08-17T12:00:00Z, a Monday, so every fixture lands on a real weekday. */
const NOON = 1_786_017_600;

function event(overrides: Partial<TripStopEvent> = {}): TripStopEvent {
  return {
    tripId: "3928",
    routeId: "NE",
    lineName: NEC,
    stopId: "NYP",
    stopName: "New York Penn",
    stopSequence: 9,
    direction: "inbound",
    serviceDate: "2026-08-17",
    scheduledArrival: NOON,
    scheduledDeparture: null,
    observedArrival: NOON + 300,
    delaySeconds: 300,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: (NOON + 300) * 1000,
    ...overrides,
  };
}

let repos: Repositories;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
  repos.gtfs.replaceStops("v1", [
    { stopId: "NWK", stopName: "Newark Penn" },
    { stopId: "NYP", stopName: "New York Penn" },
  ]);
  app = createApp(repos, silentLogger);
});

const record = async (query = "") => {
  const res = await app.request(`/trips/3928/record?from=2026-08-01&to=2026-08-31${query}`);
  return { status: res.status, body: await res.json() };
};

function runOn(serviceDate: string, delaySeconds: number | null, cancelled = false) {
  return event({
    serviceDate,
    delaySeconds,
    observedArrival: delaySeconds === null ? null : NOON + delaySeconds,
    tripCancelled: cancelled,
  });
}

describe("a departure's punctuality record", () => {
  it("returns the shape the app validates", async () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4 }),
      event(),
    ]);
    const { body } = await record();
    expect(trainRecordResponseSchema.safeParse(body).success).toBe(true);
  });

  it("names the departure by its line and where it runs from and to", async () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4 }),
      event(),
    ]);
    const { body } = await record();
    expect(body.lineName).toBe(NEC);
    expect(body.originStopName).toBe("Newark Penn");
    expect(body.terminalStopName).toBe("New York Penn");
  });

  it("measures at the terminal when no stop was asked for", async () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4, delaySeconds: 0 }),
      event({ delaySeconds: 900 }),
    ]);
    const { body } = await record();
    expect(body.measuredAtStopId).toBe("NYP");
    expect(body.medianDelaySeconds).toBe(900);
  });

  it("measures at the stop a rider asked about instead", async () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4, delaySeconds: 0 }),
      event({ delaySeconds: 900 }),
    ]);
    const { body } = await record("&stop_id=NWK");
    expect(body.measuredAtStopName).toBe("Newark Penn");
    expect(body.medianDelaySeconds).toBe(0);
  });

  it("counts the share of runs more than five minutes late", async () => {
    repos.events.recordMany([
      runOn("2026-08-17", 60),
      runOn("2026-08-18", 600),
      runOn("2026-08-19", 900),
      runOn("2026-08-20", 120),
    ]);
    const { body } = await record();
    expect(body.runs).toBe(4);
    expect(body.latePercent).toBe(50);
  });

  it("reports on-time rates at every strict threshold, not just one", async () => {
    repos.events.recordMany([runOn("2026-08-17", 60), runOn("2026-08-18", 1200)]);
    const { body } = await record();
    const at = (seconds: number) =>
      body.onTime.find((t: { thresholdSeconds: number }) => t.thresholdSeconds === seconds)?.onTimePercent;
    expect(at(300)).toBe(50);
    expect(at(1800)).toBe(100);
  });

  it("reports the delay to plan around, not just the average", async () => {
    repos.events.recordMany(
      [60, 60, 60, 60, 60, 60, 60, 60, 1800, 1800].map((d, i) => runOn(`2026-08-${10 + i}`, d)),
    );
    const { body } = await record();
    expect(body.medianDelaySeconds).toBe(60);
    expect(body.p90DelaySeconds).toBe(1800);
  });

  it("keeps a cancellation out of the delay statistics but still counts it", async () => {
    repos.events.recordMany([runOn("2026-08-17", 60), runOn("2026-08-18", null, true)]);
    const { body } = await record();
    expect(body.runs).toBe(2);
    expect(body.cancellations).toBe(1);
    // A cancellation is not a delay of zero, and averaging it in would flatter the train.
    expect(body.medianDelaySeconds).toBe(60);
    expect(body.latePercent).toBe(0);
  });

  it("shows the recent runs newest last, so the strip reads left to right", async () => {
    repos.events.recordMany([runOn("2026-08-17", 60), runOn("2026-08-18", 120), runOn("2026-08-19", 180)]);
    const { body } = await record();
    expect(body.recentRuns.map((r: { serviceDate: string }) => r.serviceDate)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
  });

  it("takes the newest runs when there are more than the strip shows", async () => {
    repos.events.recordMany(
      Array.from({ length: 5 }, (_, i) => runOn(`2026-08-1${i + 1}`, 60)),
    );
    const { body } = await record("&recent=2");
    expect(body.recentRuns).toHaveLength(2);
    expect(body.recentRuns.at(-1)?.serviceDate).toBe("2026-08-15");
  });

  it("says the sample is thin rather than printing a confident percentage", async () => {
    repos.events.recordMany([runOn("2026-08-17", 60)]);
    const { body } = await record();
    expect(body.lowSample).toBe(true);
  });

  it("reports a run with no delay recorded as null, not zero", async () => {
    repos.events.recordMany([runOn("2026-08-18", null, true)]);
    const { body } = await record();
    expect(body.recentRuns[0]?.delaySeconds).toBeNull();
    expect(body.medianDelaySeconds).toBeNull();
  });

  it("404s for a trip the archive has never seen", async () => {
    const res = await app.request("/trips/nosuchtrip/record");
    expect(res.status).toBe(404);
  });
});
