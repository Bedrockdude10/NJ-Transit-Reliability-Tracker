import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { beforeEach, describe, expect, it } from "vitest";
import { RateLimiter, planPoll } from "../src/rate-limiter";

const NOW = Date.UTC(2025, 6, 15, 12, 0, 0);
const GTFS_LIMIT = 100_000;

describe("RateLimiter", () => {
  let repos: Repositories;
  let limiter: RateLimiter;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    limiter = new RateLimiter(repos.health);
  });

  const fillGtfs = (fraction: number) => limiter.record("gtfs_rt", Math.round(GTFS_LIMIT * fraction), NOW);

  it("tracks usage and headroom", () => {
    fillGtfs(0.5);
    expect(limiter.usedFraction("gtfs_rt", NOW)).toBeCloseTo(0.5, 5);
    expect(limiter.remaining("gtfs_rt", NOW)).toBe(50_000);
    expect(limiter.withinHeadroom("gtfs_rt", NOW)).toBe(true); // 50% <= 80%
    fillGtfs(0.4); // now 90%
    expect(limiter.withinHeadroom("gtfs_rt", NOW)).toBe(false);
  });

  it("keeps TripUpdates and drops VehiclePositions first as budget fills", () => {
    expect(planPoll(limiter, NOW)).toMatchObject({ tripUpdates: true, vehiclePositions: true, serviceAlerts: true, intervalMultiplier: 1 });

    fillGtfs(0.86); // past the 0.85 VP-drop / interval-stretch tier
    let plan = planPoll(limiter, NOW);
    expect(plan).toMatchObject({ tripUpdates: true, vehiclePositions: false, serviceAlerts: true, intervalMultiplier: 2 });

    fillGtfs(0.07); // ~0.93: drop alerts too
    plan = planPoll(limiter, NOW);
    expect(plan.serviceAlerts).toBe(false);
    expect(plan.tripUpdates).toBe(true);

    fillGtfs(0.03); // ~0.96: stretch interval further, still never drop TripUpdates
    expect(planPoll(limiter, NOW).intervalMultiplier).toBe(4);
  });
});
