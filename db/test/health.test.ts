import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const DAY = Date.UTC(2025, 6, 15, 12, 0, 0);

describe("HealthRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("counts polls and failures for the day and tracks timestamps", () => {
    repos.health.recordSuccess("TripUpdates", DAY);
    repos.health.recordSuccess("TripUpdates", DAY + 1000);
    repos.health.recordFailure("TripUpdates", DAY + 2000);

    const [feed] = repos.health.feedHealth(DAY);
    expect(feed?.feedType).toBe("TripUpdates");
    expect(feed?.pollsToday).toBe(3);
    expect(feed?.failuresToday).toBe(1);
    expect(feed?.lastSuccessAtMs).toBe(DAY + 1000);
    expect(feed?.lastFailureAtMs).toBe(DAY + 2000);
  });

  it("tracks the daily request budget", () => {
    repos.health.incrementBudget("gtfs_rt", 3, DAY);
    repos.health.incrementBudget("gtfs_rt", 2, DAY);
    expect(repos.health.budgetUsed("gtfs_rt", DAY)).toBe(5);
    expect(repos.health.budgetUsed("gtfs_rt", DAY + 86_400_000)).toBe(0); // next day resets
  });

  it("sets the collection start once", () => {
    repos.health.ensureCollectionStart("2025-07-01");
    repos.health.ensureCollectionStart("2025-07-02");
    expect(repos.health.collectionStartDate()).toBe("2025-07-01");
  });

  it("computes uptime from recorded gaps", () => {
    repos.health.ensureCollectionStart("2025-07-15");
    const startMs = Date.parse("2025-07-15T00:00:00Z");
    const now = startMs + 100_000;
    repos.health.recordGap("TripUpdates", startMs + 10_000, startMs + 20_000); // 10s lost of 100s
    expect(repos.health.uptimePercent(now)).toBeCloseTo(90, 1);
  });

  // Regression: re-anchoring the collection window (after purging seeded data)
  // left a gap straddling the new start. Charging its full duration against the
  // shorter window reported 35% uptime where the real figure was 96%.
  it("counts only the part of a gap inside the collection window", () => {
    repos.health.ensureCollectionStart("2025-07-15");
    const startMs = Date.parse("2025-07-15T00:00:00Z");
    const now = startMs + 100_000;
    // Starts long before the window, ends 10s into it: only those 10s are lost.
    repos.health.recordGap("TripUpdates", startMs - 10_000_000, startMs + 10_000);
    expect(repos.health.uptimePercent(now)).toBeCloseTo(90, 1);
  });

  it("ignores a gap that ends before the window opens", () => {
    repos.health.ensureCollectionStart("2025-07-15");
    const startMs = Date.parse("2025-07-15T00:00:00Z");
    repos.health.recordGap("TripUpdates", startMs - 50_000, startMs - 10_000);
    expect(repos.health.uptimePercent(startMs + 100_000)).toBe(100);
  });

  it("does not count gap time in the future", () => {
    repos.health.ensureCollectionStart("2025-07-15");
    const startMs = Date.parse("2025-07-15T00:00:00Z");
    const now = startMs + 100_000;
    repos.health.recordGap("TripUpdates", startMs + 90_000, startMs + 10_000_000);
    expect(repos.health.uptimePercent(now)).toBeCloseTo(90, 1);
  });

  it("returns 100% uptime before collection has started", () => {
    expect(repos.health.uptimePercent(DAY)).toBe(100);
  });

  it("accepts a pre-resolved start date (same result as the internal lookup)", () => {
    repos.health.ensureCollectionStart("2025-07-15");
    const startMs = Date.parse("2025-07-15T00:00:00Z");
    const now = startMs + 100_000;
    repos.health.recordGap("TripUpdates", startMs + 10_000, startMs + 20_000);
    expect(repos.health.uptimePercent(now, "2025-07-15")).toBeCloseTo(repos.health.uptimePercent(now), 5);
  });
});
