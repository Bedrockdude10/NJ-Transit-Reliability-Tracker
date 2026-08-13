import type { TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, prefersIncomingReading, type Repositories } from "../src";

/**
 * `prefersIncomingReading` mirrors the `WHERE` clause of the live upsert so the
 * replay can arbitrate in memory before it writes. If the two ever disagree, a
 * replay silently rewrites history with a different answer than live ingest
 * produced — the kind of corruption nothing else would catch.
 *
 * These tests hold them together: for each case the SQL is exercised through
 * the repository and its outcome compared with the pure function's verdict.
 */

const DATE = "2026-08-13";
const SCHEDULED = Math.floor(Date.parse(`${DATE}T12:00:00Z`) / 1000);

function event(over: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "T1",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "NWK",
    stopName: "Newark Penn",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: DATE,
    scheduledArrival: SCHEDULED,
    scheduledDeparture: SCHEDULED + 60,
    observedArrival: SCHEDULED,
    delaySeconds: 0,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: SCHEDULED * 1000,
    ...over,
  };
}

describe("prefersIncomingReading matches the stored upsert rule", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  /** Write `stored`, then `incoming`; report whether the row actually changed. */
  function sqlAccepted(stored: TripStopEvent, incoming: TripStopEvent): boolean {
    repos.events.record(stored);
    repos.events.record(incoming);
    const after = repos.events.getByServiceDate(DATE)[0];
    return after?.delaySeconds === incoming.delaySeconds && after?.ingestedAtMs === incoming.ingestedAtMs;
  }

  const cases: { name: string; stored: TripStopEvent; incoming: TripStopEvent }[] = [
    {
      name: "incoming taken nearer the scheduled arrival",
      stored: event({ delaySeconds: 60, ingestedAtMs: (SCHEDULED - 3600) * 1000 }),
      incoming: event({ delaySeconds: 900, ingestedAtMs: (SCHEDULED - 60) * 1000 }),
    },
    {
      name: "incoming taken further from the scheduled arrival",
      stored: event({ delaySeconds: 900, ingestedAtMs: (SCHEDULED - 60) * 1000 }),
      incoming: event({ delaySeconds: 60, ingestedAtMs: (SCHEDULED - 3600) * 1000 }),
    },
    {
      name: "a cancellation, however late it arrives",
      stored: event({ delaySeconds: 0, ingestedAtMs: SCHEDULED * 1000 }),
      incoming: event({ tripCancelled: true, delaySeconds: null, ingestedAtMs: (SCHEDULED - 99_999) * 1000 }),
    },
    {
      name: "stored has no measurement yet",
      stored: event({ delaySeconds: null, ingestedAtMs: SCHEDULED * 1000 }),
      incoming: event({ delaySeconds: 300, ingestedAtMs: (SCHEDULED - 99_999) * 1000 }),
    },
    {
      name: "incoming has no scheduled arrival to judge by",
      stored: event({ delaySeconds: 0, ingestedAtMs: SCHEDULED * 1000 }),
      incoming: event({ scheduledArrival: null, delaySeconds: 42, ingestedAtMs: (SCHEDULED - 99_999) * 1000 }),
    },
    {
      name: "equally close — no reason to displace what is already there",
      stored: event({ delaySeconds: 60, ingestedAtMs: (SCHEDULED - 60) * 1000 }),
      incoming: event({ delaySeconds: 900, ingestedAtMs: (SCHEDULED + 60) * 1000 }),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const sql = sqlAccepted(c.stored, c.incoming);
      const pure = prefersIncomingReading(c.stored, c.incoming);
      expect(pure, `pure function disagrees with SQL for: ${c.name}`).toBe(sql);
    });
  }
});
