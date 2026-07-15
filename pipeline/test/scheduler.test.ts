import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../src/clock";
import { loadConfig, type PipelineConfig } from "../src/config";
import type { Ingestor } from "../src/ingestor";
import { RateLimiter } from "../src/rate-limiter";
import { startScheduler } from "../src/scheduler";

const NOW = Date.UTC(2025, 6, 15, 12, 0, 0);
const GTFS_LIMIT = 100_000;
const clock: Clock = { now: () => NOW, sleep: () => Promise.resolve() };
const config: PipelineConfig = loadConfig({});

interface Calls {
  tu: number;
  vp: number;
  sa: number;
  recompute: number;
  staleness: number;
}

function makeIngestor(tripUpdates?: () => Promise<unknown>): { ingestor: Ingestor; calls: Calls } {
  const calls: Calls = { tu: 0, vp: 0, sa: 0, recompute: 0, staleness: 0 };
  const ingestor = {
    pollTripUpdates: tripUpdates ?? (async () => (calls.tu++, true)),
    pollVehiclePositions: async () => (calls.vp++, true),
    pollServiceAlerts: async () => (calls.sa++, true),
    recompute: () => {
      calls.recompute++;
    },
    checkStaleness: async () => (calls.staleness++, true),
  } as unknown as Ingestor;
  return { ingestor, calls };
}

describe("startScheduler", () => {
  let repos: Repositories;
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    repos = createRepositories(openDatabase());
    limiter = new RateLimiter(repos.health);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fillGtfs = (fraction: number) => limiter.record("gtfs_rt", Math.round(GTFS_LIMIT * fraction), NOW);

  it("always polls TripUpdates but skips VehiclePositions/ServiceAlerts when the budget says so", async () => {
    fillGtfs(0.95); // planPoll: vehiclePositions=false, serviceAlerts=false, intervalMultiplier=4
    const { ingestor, calls } = makeIngestor();
    const scheduler = startScheduler(ingestor, limiter, config, clock);

    // Past the stretched TripUpdates delay (30s * 4) and several VP/SA ticks.
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs * 4 + 1_000);

    expect(calls.tu).toBeGreaterThanOrEqual(1);
    expect(calls.vp).toBe(0);
    expect(calls.sa).toBe(0);
    scheduler.stop();
  });

  it("scales the TripUpdates delay by planPoll's intervalMultiplier", async () => {
    // Empty budget → multiplier 1: fires at the base interval.
    const base = makeIngestor();
    const s1 = startScheduler(base.ingestor, limiter, config, clock);
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs + 1);
    expect(base.calls.tu).toBe(1);
    s1.stop();

    // Fill the budget → multiplier 4: silent through the base interval.
    fillGtfs(0.95);
    const stretched = makeIngestor();
    const s2 = startScheduler(stretched.ingestor, limiter, config, clock);
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs + 1);
    expect(stretched.calls.tu).toBe(0);
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs * 3);
    expect(stretched.calls.tu).toBe(1);
    s2.stop();
  });

  it("stop() clears timers and halts rescheduling", async () => {
    const { ingestor, calls } = makeIngestor();
    const scheduler = startScheduler(ingestor, limiter, config, clock);
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs + 1);
    const polledBeforeStop = calls.tu;
    expect(polledBeforeStop).toBeGreaterThanOrEqual(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs * 10);
    expect(calls.tu).toBe(polledBeforeStop); // no further polls after stop()
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reschedules even when a task throws (the finally path)", async () => {
    let count = 0;
    const throwing = async (): Promise<never> => {
      count++;
      throw new Error("boom");
    };
    const { ingestor } = makeIngestor(throwing);

    // The scheduler does not catch, so each throw surfaces as an unhandled
    // rejection; swallow it here so we can assert the reschedule still happens.
    const swallow = (): void => {};
    process.on("unhandledRejection", swallow);
    try {
      const scheduler = startScheduler(ingestor, limiter, config, clock);
      await vi.advanceTimersByTimeAsync(config.intervals.tripUpdatesMs * 3 + 10);
      scheduler.stop();
    } finally {
      process.off("unhandledRejection", swallow);
    }

    expect(count).toBeGreaterThanOrEqual(2); // threw, then rescheduled and ran again
  });
});
