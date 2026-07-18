import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const bytes = (...vals: number[]) => Uint8Array.from(vals);

describe("RawSnapshotRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("inserts a snapshot and returns its row id", () => {
    const id = repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 1000, rawBytes: bytes(1, 2, 3) });
    expect(id).toBeGreaterThan(0);
  });

  it("latest returns the most recent snapshot for a feed, or null when none", () => {
    expect(repos.snapshots.latest("TripUpdates")).toBeNull();

    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 1000, rawBytes: bytes(1) });
    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 3000, rawBytes: bytes(9, 9) });
    repos.snapshots.insert({ feedType: "VehiclePositions", fetchedAtMs: 9000, rawBytes: bytes(7) });

    const latest = repos.snapshots.latest("TripUpdates");
    expect(latest?.fetchedAtMs).toBe(3000);
    expect(latest?.feedType).toBe("TripUpdates");
    expect(Array.from(latest?.rawBytes ?? [])).toEqual([9, 9]);
    expect(latest?.id).toBeGreaterThan(0);
  });

  it("count totals all feeds and filters by feed type", () => {
    expect(repos.snapshots.count()).toBe(0);

    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 1, rawBytes: bytes(1) });
    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 2, rawBytes: bytes(2) });
    repos.snapshots.insert({ feedType: "ServiceAlerts", fetchedAtMs: 3, rawBytes: bytes(3) });

    expect(repos.snapshots.count()).toBe(3);
    expect(repos.snapshots.count("TripUpdates")).toBe(2);
    expect(repos.snapshots.count("ServiceAlerts")).toBe(1);
    expect(repos.snapshots.count("VehiclePositions")).toBe(0);
  });
});
