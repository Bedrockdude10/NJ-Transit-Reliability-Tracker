import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { recomputeServiceDate } from "../src/aggregator";
import { purgeSeedData } from "../src/maintenance/purge-seed-data";

const SEED_DATES = ["2026-05-27", "2026-05-28"] as const;
const REAL_DATES = ["2026-07-14", "2026-07-15"] as const;

const SEED_START = SEED_DATES[0];
const SEED_END = SEED_DATES[1];
const REAL_START = REAL_DATES[0];
const REAL_END = REAL_DATES[1];

function event(overrides: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "2131202",
    routeId: "NC",
    lineName: "North Jersey Coast Line",
    stopId: "1",
    stopName: "Aberdeen-Matawan",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: REAL_START,
    scheduledArrival: 1000,
    scheduledDeparture: 1060,
    observedArrival: 1120,
    delaySeconds: 120,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("purgeSeedData", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    for (const d of SEED_DATES) {
      repos.events.record(event({ tripId: "PJ-outbound-8", serviceDate: d }));
      repos.events.record(event({ tripId: "NE-inbound-3", serviceDate: d, stopId: "2" }));
      recomputeServiceDate(repos, d);
    }
    for (const d of REAL_DATES) {
      repos.events.record(event({ tripId: "2131202", serviceDate: d }));
      repos.events.record(event({ tripId: "", serviceDate: d, stopId: "2" })); // real, no trip id
      recomputeServiceDate(repos, d);
    }
    repos.health.setMeta("collection_start_date", SEED_START);
  });

  it("previews without writing anything", () => {
    const result = purgeSeedData(repos, { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, eventsDeleted: 4, collectionStartAfter: REAL_START });
    expect(repos.events.count()).toBe(8); // untouched
    expect(repos.health.collectionStartDate()).toBe(SEED_START);
  });

  it("deletes only fabricated events, keeping real ones including empty trip ids", () => {
    const result = purgeSeedData(repos);

    expect(result.eventsDeleted).toBe(4);
    expect(repos.events.count()).toBe(4);
    expect(repos.events.distinctLineNames()).toEqual(["North Jersey Coast Line"]);
    // The empty-trip-id rows are real observations the feed supplied without an id.
    expect(repos.events.getByServiceDate(REAL_START).map((e) => e.tripId).sort()).toEqual(["", "2131202"]);
  });

  it("clears the rollups for days that were entirely fabricated", () => {
    expect(repos.aggregates.stationByLineDirection("1", SEED_START, SEED_END)).not.toEqual([]);

    purgeSeedData(repos);

    expect(repos.aggregates.stationByLineDirection("1", SEED_START, SEED_END)).toEqual([]);
    // Real days survive untouched.
    expect(repos.aggregates.stationByLineDirection("1", REAL_START, REAL_END)).not.toEqual([]);
  });

  it("re-anchors the collection window to the first real observation", () => {
    const result = purgeSeedData(repos);

    expect(result.collectionStartBefore).toBe(SEED_START);
    expect(result.collectionStartAfter).toBe(REAL_START);
    expect(repos.health.collectionStartDate()).toBe(REAL_START);
  });

  // Uptime divides lost time by the collection window, so a gap sitting before
  // the window would report coverage loss for time never claimed.
  it("drops gaps that fall wholly before the new window", () => {
    const beforeWindow = Date.parse("2026-06-25T00:00:00Z");
    repos.health.recordGap("TripUpdates", beforeWindow, Date.parse("2026-07-13T00:00:00Z"));
    repos.health.recordGap("TripUpdates", Date.parse("2026-07-20T00:00:00Z"), Date.parse("2026-07-20T01:00:00Z"));

    const result = purgeSeedData(repos);

    expect(result.gapsDropped).toBe(1);
    expect(repos.health.gaps()).toHaveLength(1);
    expect(repos.health.uptimePercent(Date.parse("2026-08-13T00:00:00Z"))).toBeGreaterThan(99);
  });

  it("is idempotent and reports nothing on a clean database", () => {
    purgeSeedData(repos);
    const second = purgeSeedData(repos);

    expect(second.eventsDeleted).toBe(0);
    expect(second.serviceDatesRecomputed).toEqual([]);
    expect(repos.events.count()).toBe(4);
  });
});
