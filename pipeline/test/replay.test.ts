import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { beforeEach, describe, expect, it } from "vitest";
import { replayRange, replayServiceDate, totalsOf, windowForServiceDate } from "../src/replay/replay";

const { transit_realtime: tr } = GtfsRealtimeBindings;

const DATE = "2026-08-13";
/** 08:00 local on the service date. */
const MORNING_MS = Date.parse(`${DATE}T12:00:00Z`);

function snapshotBytes(entities: unknown[]): Uint8Array {
  return tr.FeedMessage.encode({ header: { gtfsRealtimeVersion: "2.0" }, entity: entities as never }).finish();
}

/** One trip calling at one stop, with a given predicted arrival + delay. */
function poll(tripId: string, stopId: string, arrivalEpoch: number, delay: number) {
  return [
    {
      id: "e1",
      tripUpdate: {
        trip: { tripId, routeId: "NE", startDate: DATE.replace(/-/g, ""), directionId: 1 },
        stopTimeUpdate: [{ stopId, stopSequence: 1, arrival: { time: arrivalEpoch, delay } }],
      },
    },
  ];
}

describe("windowForServiceDate", () => {
  it("reaches before and after the day, since polls straddle midnight", () => {
    const { fromMs, toMs } = windowForServiceDate(DATE);
    expect(fromMs).toBeLessThan(Date.parse(`${DATE}T04:00:00Z`)); // local midnight
    expect(toMs).toBeGreaterThan(Date.parse(`2026-08-14T04:00:00Z`));
  });
});

describe("replayServiceDate", () => {
  let repos: Repositories;

  beforeEach(() => {
    repos = createRepositories(openDatabase());
    repos.gtfs.insertVersion({
      versionId: "v1",
      effectiveFrom: Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000),
      effectiveTo: null,
      checksum: "c1",
      ingestedAtMs: 0,
    });
    repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
    repos.gtfs.replaceStops("v1", [{ stopId: "NWK", stopName: "Newark Penn", stopLat: 40.73, stopLon: -74.16 }]);
    repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
    repos.gtfs.replaceStopTimes("v1", [
      { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
    ]);
  });

  const archive = (fetchedAtMs: number, entities: unknown[]) =>
    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs, rawBytes: snapshotBytes(entities) });

  it("derives events from the archive when none are stored", () => {
    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 300, 300));

    const result = replayServiceDate(repos, DATE);
    expect(result).toMatchObject({ snapshotsDecoded: 1, eventsDerived: 1, added: 1, unchanged: 0, changed: 0 });
    // Preview writes nothing.
    expect(repos.events.count()).toBe(0);
  });

  it("writes and recomputes only when applied", () => {
    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 300, 300));

    replayServiceDate(repos, DATE, { apply: true });
    expect(repos.events.count()).toBe(1);
    expect(repos.aggregates.stationByLineDirection("NWK", DATE, DATE).length).toBeGreaterThan(0);
  });

  // The property the whole thing rests on: replaying reproduces live ingest,
  // so a replay of unchanged code is a no-op rather than a rewrite.
  it("reproduces what live ingest already stored, byte for byte", () => {
    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 300, 300));
    replayServiceDate(repos, DATE, { apply: true });

    const second = replayServiceDate(repos, DATE);
    expect(second).toMatchObject({ unchanged: 1, changed: 0, added: 0, orphaned: 0 });
  });

  // The pipeline keeps the reading taken closest to the scheduled arrival, not
  // the newest — a poll near the moment a train is due carries a better
  // estimate. The replay has to make the same choice or it would rewrite
  // history with a differently-derived answer.
  it("keeps the reading closest to the scheduled arrival, not the last seen", () => {
    const scheduled = MORNING_MS / 1000; // T1 is timetabled at 08:00 local
    archive(scheduled * 1000 - 3_600_000, poll("T1", "NWK", scheduled + 60, 60)); // an hour out
    archive(scheduled * 1000 - 60_000, poll("T1", "NWK", scheduled + 900, 900)); // a minute out

    replayServiceDate(repos, DATE, { apply: true });
    expect(repos.events.getByServiceDate(DATE)[0]?.delaySeconds).toBe(900);
  });

  it("is unmoved by the order polls happen to arrive in", () => {
    const scheduled = MORNING_MS / 1000;
    // The good estimate is archived first; a stale one arrives afterwards.
    archive(scheduled * 1000 - 60_000, poll("T1", "NWK", scheduled + 900, 900));
    archive(scheduled * 1000 - 3_600_000, poll("T1", "NWK", scheduled + 60, 60));

    replayServiceDate(repos, DATE, { apply: true });
    expect(repos.events.getByServiceDate(DATE)[0]?.delaySeconds).toBe(900);
  });

  it("reports a stored event the archive would change, without writing it", () => {
    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 900, 900));
    replayServiceDate(repos, DATE, { apply: true });

    // Corrupt the stored row the way a parser bug would have.
    repos.events.relabelLineName("Northeast Corridor Line", "10", "10");

    const preview = replayServiceDate(repos, DATE);
    expect(preview).toMatchObject({ changed: 1, unchanged: 0 });
    expect(repos.events.getByServiceDate(DATE)[0]?.lineName).toBe("10"); // untouched

    replayServiceDate(repos, DATE, { apply: true });
    expect(repos.events.getByServiceDate(DATE)[0]?.lineName).toBe("Northeast Corridor Line");
  });

  // Deleting on the assumption that "not re-derived" means "not real" is how
  // history gets lost when snapshots have been pruned.
  it("counts but never removes stored events the archive cannot account for", () => {
    repos.events.record({
      tripId: "GHOST",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      stopId: "NWK",
      stopName: "Newark Penn",
      stopSequence: 1,
      direction: "inbound",
      serviceDate: DATE,
      scheduledArrival: 1,
      scheduledDeparture: 1,
      observedArrival: 1,
      delaySeconds: 0,
      stopSkipped: false,
      tripCancelled: false,
      gtfsStaticVersion: "v1",
      ingestedAtMs: 1,
    });
    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 300, 300));

    const result = replayServiceDate(repos, DATE, { apply: true });
    expect(result.orphaned).toBe(1);
    expect(repos.events.getByServiceDate(DATE).some((e) => e.tripId === "GHOST")).toBe(true);
  });

  it("ignores snapshots outside the day's window", () => {
    archive(MORNING_MS - 5 * 86_400_000, poll("T1", "NWK", MORNING_MS / 1000, 0));
    expect(replayServiceDate(repos, DATE).snapshotsDecoded).toBe(0);
  });

  it("keeps only events belonging to the date being replayed", () => {
    // A poll late on the 13th also carrying a trip dated the 14th.
    archive(MORNING_MS, [
      ...poll("T1", "NWK", MORNING_MS / 1000 + 300, 300),
      {
        id: "e2",
        tripUpdate: {
          trip: { tripId: "T1", routeId: "NE", startDate: "20260814", directionId: 1 },
          stopTimeUpdate: [{ stopId: "NWK", stopSequence: 1, arrival: { time: MORNING_MS / 1000 + 90_000, delay: 0 } }],
        },
      },
    ]);

    const result = replayServiceDate(repos, DATE, { apply: true });
    expect(result.eventsDerived).toBe(1);
    expect(repos.events.getByServiceDate(DATE)).toHaveLength(1);
    expect(repos.events.getByServiceDate("2026-08-14")).toHaveLength(0);
  });

  it("pages through more snapshots than fit in one batch", () => {
    const scheduled = MORNING_MS / 1000;
    // Polls march towards the scheduled arrival, so each is a better estimate
    // than the last and the final one wins on merit rather than on recency.
    for (let i = 0; i < 250; i++) {
      archive(scheduled * 1000 - (250 - i) * 10_000, poll("T1", "NWK", scheduled + i, i));
    }
    const result = replayServiceDate(repos, DATE, { apply: true });
    expect(result.snapshotsDecoded).toBe(250);
    expect(repos.events.getByServiceDate(DATE)[0]?.delaySeconds).toBe(249);
  });

  it("survives an empty feed body without producing events", () => {
    repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: MORNING_MS, rawBytes: new Uint8Array() });
    expect(replayServiceDate(repos, DATE)).toMatchObject({ snapshotsDecoded: 1, eventsDerived: 0 });
  });

  it("parses against the GTFS version effective at the snapshot, not today's", () => {
    // A newer version arrives later and no longer carries the trip at all.
    repos.gtfs.supersede("v1", Math.floor(Date.parse("2026-08-20T00:00:00Z") / 1000));
    repos.gtfs.insertVersion({
      versionId: "v2",
      effectiveFrom: Math.floor(Date.parse("2026-08-20T00:00:00Z") / 1000),
      effectiveTo: null,
      checksum: "c2",
      ingestedAtMs: 0,
    });
    repos.gtfs.replaceRoutes("v2", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);

    archive(MORNING_MS, poll("T1", "NWK", MORNING_MS / 1000 + 300, 300));
    replayServiceDate(repos, DATE, { apply: true });

    // Resolved through v1's schedule, so the stop name came from GTFS.
    expect(repos.events.getByServiceDate(DATE)[0]).toMatchObject({
      stopName: "Newark Penn",
      gtfsStaticVersion: "v1",
    });
  });
});

describe("replayRange", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("walks each day in the range, oldest first", () => {
    const seen: string[] = [];
    const result = replayRange(repos, "2026-08-11", "2026-08-13", { betweenDates: (d) => seen.push(d.serviceDate) });
    expect(seen).toEqual(["2026-08-11", "2026-08-12", "2026-08-13"]);
    expect(result.dates).toHaveLength(3);
    expect(result.applied).toBe(false);
  });

  it("totals a run for reporting", () => {
    const result = replayRange(repos, "2026-08-12", "2026-08-13");
    expect(totalsOf(result)).toEqual({
      snapshotsDecoded: 0,
      eventsDerived: 0,
      unchanged: 0,
      changed: 0,
      added: 0,
      orphaned: 0,
    });
  });
});
