import {
  PEAK_WINDOWS,
  bucketForDelay,
  isPeak,
  localDayOfWeek,
  type ConnectionDailyRow,
  type TripStopEvent,
} from "@njt/shared";
import { describe, expect, it } from "vitest";
import { computeAggregates } from "../src/aggregator";

const DATE = "2025-07-15";

/**
 * The optimization under test: `computeConnections` was rewritten from an
 * O(arrivals × departures) nested loop into a sorted two-pointer sweep. This
 * suite locks in EQUIVALENCE by comparing the current implementation against a
 * deliberately naive brute-force reference that re-states the *original*
 * nested-loop semantics: for every arrival, pair it with every departure whose
 * scheduled time falls in `[schedArr, schedArr + maxWindow]`, excluding the
 * same trip. The two must agree on every connection row (order-insensitively)
 * over many randomized-but-seeded event sets.
 */

// ---- deterministic PRNG (mulberry32) so failures are reproducible ----------
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ev(o: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "A",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "NWK",
    stopName: "Newark Penn",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: DATE,
    scheduledArrival: null,
    scheduledDeparture: null,
    observedArrival: null,
    delaySeconds: null,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: 0,
    ...o,
  };
}

/**
 * Brute-force reference — the original nested-loop pairing. Reuses the shared
 * pure helpers for bucketing (peak / day-of-week / delay label) so the only
 * thing being compared is the *candidate-pairing* algorithm, not the arithmetic.
 */
function bruteForceConnections(
  events: readonly TripStopEvent[],
  tz: string,
  maxWindow: number,
  minBuffer: number,
): ConnectionDailyRow[] {
  const byStop = new Map<string, TripStopEvent[]>();
  for (const e of events) {
    const list = byStop.get(e.stopId) ?? [];
    list.push(e);
    byStop.set(e.stopId, list);
  }

  interface Acc {
    inboundTripId: string;
    transferStopId: string;
    outboundTripId: string;
    observations: number;
    successes: number;
    peakObservations: number;
    peakSuccesses: number;
    offPeakObservations: number;
    offPeakSuccesses: number;
    byDayOfWeek: Record<string, { observations: number; successes: number }>;
    inboundDelayDistribution: Record<string, number>;
  }
  const acc = new Map<string, Acc>();

  for (const [stopId, stopEvents] of byStop) {
    const arrivals = stopEvents.filter(
      (e) => !e.tripCancelled && e.scheduledArrival !== null && e.observedArrival !== null,
    );
    const departures = stopEvents.filter((e) => !e.tripCancelled && e.scheduledDeparture !== null);

    for (const inbound of arrivals) {
      const schedArr = inbound.scheduledArrival as number;
      const actualArr = inbound.observedArrival as number;
      for (const outbound of departures) {
        const dep = outbound.scheduledDeparture as number;
        // Original nested-loop window test, inclusive on both ends.
        if (dep < schedArr) continue;
        if (dep > schedArr + maxWindow) continue;
        if (outbound.tripId === inbound.tripId) continue;

        const key = `${inbound.tripId}|${stopId}|${outbound.tripId}`;
        const c =
          acc.get(key) ??
          {
            inboundTripId: inbound.tripId,
            transferStopId: stopId,
            outboundTripId: outbound.tripId,
            observations: 0,
            successes: 0,
            peakObservations: 0,
            peakSuccesses: 0,
            offPeakObservations: 0,
            offPeakSuccesses: 0,
            byDayOfWeek: {},
            inboundDelayDistribution: {},
          };

        const success = actualArr <= dep - minBuffer;
        const peak = isPeak(schedArr, PEAK_WINDOWS, tz);
        const dow = String(localDayOfWeek(schedArr, tz));
        const label = bucketForDelay(actualArr - schedArr).label;

        c.observations += 1;
        if (success) c.successes += 1;
        if (peak) {
          c.peakObservations += 1;
          if (success) c.peakSuccesses += 1;
        } else {
          c.offPeakObservations += 1;
          if (success) c.offPeakSuccesses += 1;
        }
        const d = c.byDayOfWeek[dow] ?? { observations: 0, successes: 0 };
        d.observations += 1;
        if (success) d.successes += 1;
        c.byDayOfWeek[dow] = d;
        c.inboundDelayDistribution[label] = (c.inboundDelayDistribution[label] ?? 0) + 1;

        acc.set(key, c);
      }
    }
  }

  return [...acc.values()].map((c) => ({ ...c, serviceDate: DATE }));
}

/** Order-insensitive keyed index of connection rows for comparison. */
function indexByKey(rows: readonly ConnectionDailyRow[]): Map<string, ConnectionDailyRow> {
  const m = new Map<string, ConnectionDailyRow>();
  for (const r of rows) m.set(`${r.inboundTripId}|${r.transferStopId}|${r.outboundTripId}`, r);
  return m;
}

function expectEquivalent(actual: readonly ConnectionDailyRow[], expected: readonly ConnectionDailyRow[]): void {
  const a = indexByKey(actual);
  const b = indexByKey(expected);
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  for (const [key, exp] of b) {
    const got = a.get(key);
    expect(got, `missing row ${key}`).toBeDefined();
    // Compare every distribution / count field. byDayOfWeek + distribution are
    // plain records, so toEqual handles them order-insensitively.
    expect(got).toMatchObject({
      observations: exp.observations,
      successes: exp.successes,
      peakObservations: exp.peakObservations,
      peakSuccesses: exp.peakSuccesses,
      offPeakObservations: exp.offPeakObservations,
      offPeakSuccesses: exp.offPeakSuccesses,
      byDayOfWeek: exp.byDayOfWeek,
      inboundDelayDistribution: exp.inboundDelayDistribution,
    });
  }
}

/** Generate a randomized-but-seeded event set exercising the transfer logic. */
function generateEvents(seed: number): TripStopEvent[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const stops = ["NWK", "NYP", "SEC", "TRE"]; // several transfer stops (+ some singletons)
  // Base instant near the AM peak so isPeak / off-peak both get exercised.
  const base = Math.floor(Date.UTC(2025, 6, 15, 10, 30, 0) / 1000); // ~06:30 EDT
  const events: TripStopEvent[] = [];
  const tripCount = 3 + Math.floor(r() * 8); // 3..10 trips

  for (let t = 0; t < tripCount; t++) {
    const tripId = `T${t}`;
    const cancelled = r() < 0.15;
    const stopsForTrip = 1 + Math.floor(r() * 3); // 1..3 stops per trip
    for (let s = 0; s < stopsForTrip; s++) {
      const stopId = pick(stops);
      // Times spread across a few hours; wide enough to fall in/out of windows.
      const schedArr = base + Math.floor(r() * 4 * 3600); // within 4h
      const hasArr = r() < 0.85;
      const hasObs = r() < 0.9;
      const hasDep = r() < 0.85;
      const delay = Math.floor((r() - 0.4) * 1800); // -720..+1080s
      events.push(
        ev({
          tripId,
          stopId,
          stopName: stopId,
          stopSequence: s + 1,
          tripCancelled: cancelled,
          scheduledArrival: hasArr ? schedArr : null,
          observedArrival: hasArr && hasObs ? schedArr + delay : null,
          scheduledDeparture: hasDep ? schedArr + Math.floor(r() * 600) : null,
          delaySeconds: hasArr ? delay : null,
        }),
      );
    }
  }
  return events;
}

describe("computeConnections — two-pointer sweep matches brute force", () => {
  const tz = "America/New_York";
  // Vary the transfer window + required buffer across cases.
  const paramSets = [
    { maxTransferWindowSeconds: 1800, minTransferBufferSeconds: 0 },
    { maxTransferWindowSeconds: 600, minTransferBufferSeconds: 60 },
    { maxTransferWindowSeconds: 3600, minTransferBufferSeconds: 120 },
    { maxTransferWindowSeconds: 300, minTransferBufferSeconds: 0 },
  ];

  for (let seed = 1; seed <= 40; seed++) {
    const params = paramSets[seed % paramSets.length]!;
    it(`equivalent for seed ${seed} (window=${params.maxTransferWindowSeconds}s, buffer=${params.minTransferBufferSeconds}s)`, () => {
      const events = generateEvents(seed);
      const { connections } = computeAggregates(events, DATE, { timeZone: tz, ...params });
      const reference = bruteForceConnections(
        events,
        tz,
        params.maxTransferWindowSeconds,
        params.minTransferBufferSeconds,
      );
      expectEquivalent(connections, reference);
    });
  }

  it("produces at least one non-empty case across the seeds (sanity: not trivially all-empty)", () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const events = generateEvents(seed);
      total += computeAggregates(events, DATE, { timeZone: tz }).connections.length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it("boundary window: departures exactly at schedArr and schedArr+maxWindow are inclusive", () => {
    const maxWindow = 1000;
    const events: TripStopEvent[] = [
      ev({ tripId: "IN", stopId: "NWK", scheduledArrival: 5000, observedArrival: 5000, stopSequence: 1 }),
      // dep == schedArr (inclusive lower bound)
      ev({ tripId: "LO", stopId: "NWK", scheduledDeparture: 5000, stopSequence: 1 }),
      // dep == schedArr + maxWindow (inclusive upper bound)
      ev({ tripId: "HI", stopId: "NWK", scheduledDeparture: 6000, stopSequence: 1 }),
      // dep just past the window (excluded)
      ev({ tripId: "OUT", stopId: "NWK", scheduledDeparture: 6001, stopSequence: 1 }),
      // dep just before schedArr (excluded)
      ev({ tripId: "PRE", stopId: "NWK", scheduledDeparture: 4999, stopSequence: 1 }),
    ];
    const { connections } = computeAggregates(events, DATE, { maxTransferWindowSeconds: maxWindow });
    const outbounds = connections.filter((c) => c.inboundTripId === "IN").map((c) => c.outboundTripId).sort();
    expect(outbounds).toEqual(["HI", "LO"]);
    // And equivalence with brute force on the same tricky input.
    expectEquivalent(connections, bruteForceConnections(events, NJT_TZ, maxWindow, 0));
  });
});

const NJT_TZ = "America/New_York";
