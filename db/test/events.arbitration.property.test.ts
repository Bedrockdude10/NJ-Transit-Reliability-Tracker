import type { TripStopEvent } from "@njt/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRepositories, openDatabase, prefersIncomingReading } from "../src";

/**
 * The arbitration rule decides which of many polls of the same train becomes
 * the stored truth. Two things were asserted here, over arbitrary inputs rather
 * than the handful of examples in the parity test:
 *
 * 1. **Parity between the SQL and its TypeScript mirror.** Holds everywhere.
 * 2. **Order independence** — live ingest sees polls as they arrive, replay
 *    reads them back out of the archive, and the two must agree.
 *
 * The second turned out to be false in general. Four cases decide by arrival
 * order rather than by evidence, and they are pinned in the second describe
 * block below. Replay is nonetheless safe today because it walks the archive
 * chronologically, in the same order live ingest saw; the real guarantee is
 * "same order, same answer", which is weaker than `prefersIncomingReading`'s
 * doc comment implies. One of the four also loses a measured delay outright.
 */

const DATE = "2026-08-13";
const SCHEDULED = Math.floor(Date.parse(`${DATE}T12:00:00Z`) / 1000);

/** A poll of one train at one stop: same key, differing observations. */
const reading = fc
  .record({
    // Minutes before/after the scheduled time that this poll was taken.
    offsetMinutes: fc.integer({ min: -180, max: 180 }),
    delaySeconds: fc.option(fc.integer({ min: -600, max: 3600 }), { nil: null }),
    scheduledArrival: fc.option(fc.constant(SCHEDULED), { nil: null }),
    tripCancelled: fc.boolean(),
    stopSkipped: fc.boolean(),
  })
  .map(
    ({ offsetMinutes, delaySeconds, scheduledArrival, tripCancelled, stopSkipped }): TripStopEvent => ({
      tripId: "T1",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      stopId: "NWK",
      stopName: "Newark Penn",
      stopSequence: 1,
      direction: "inbound",
      serviceDate: DATE,
      scheduledArrival,
      scheduledDeparture: SCHEDULED + 60,
      observedArrival: delaySeconds === null ? null : SCHEDULED + delaySeconds,
      delaySeconds,
      stopSkipped,
      tripCancelled,
      gtfsStaticVersion: "v1",
      ingestedAtMs: (SCHEDULED + offsetMinutes * 60) * 1000,
    }),
  );

/** Ingest a sequence through the real upsert and return what was stored. */
function ingest(readings: readonly TripStopEvent[]): TripStopEvent | undefined {
  const db = openDatabase();
  const repos = createRepositories(db);
  for (const r of readings) repos.events.record(r);
  const stored = repos.events.getByServiceDate(DATE);
  db.close();
  return stored[0];
}

describe("arbitration properties", () => {
  it("agrees with its SQL mirror on arbitrary pairs", () => {
    fc.assert(
      fc.property(reading, reading, (first, second) => {
        const stored = ingest([first, second])!;
        const predicted = prefersIncomingReading(first, second) ? second : first;
        expect(stored.ingestedAtMs).toBe(predicted.ingestedAtMs);
        expect(stored.delaySeconds).toBe(predicted.delaySeconds);
        expect(stored.tripCancelled).toBe(predicted.tripCancelled);
      }),
    );
  });

  /**
   * The invariant replay rests on — but only where the rule can actually
   * discriminate. Written unconditionally this property fails, which is how the
   * three exceptions below were found; each one is a tie the rule breaks by
   * arrival order rather than by evidence.
   *
   * Replay is safe today because it reads the archive chronologically, the same
   * order live ingest saw. The guarantee is "same order, same answer", which is
   * weaker than the module's docs imply.
   */
  it("reaches the same stored reading regardless of ingest order", () => {
    const discriminating = fc
      .array(reading, { minLength: 2, maxLength: 6 })
      .filter((rs) => {
        if (rs.some((r) => r.tripCancelled || r.scheduledArrival === null)) return false;
        // A reading with no delay wins when it is already stored but loses on
        // distance when it arrives: see the asymmetry test below.
        if (rs.some((r) => r.delaySeconds === null)) return false;
        // Ties are broken by order, so exclude them: see the tie test below.
        const distances = rs.map((r) => Math.abs(r.ingestedAtMs - r.scheduledArrival! * 1000));
        return new Set(distances).size === distances.length;
      });

    fc.assert(
      fc.property(discriminating, (readings) => {
        const forward = ingest(readings);
        const backward = ingest([...readings].reverse());
        expect(backward?.delaySeconds).toBe(forward?.delaySeconds);
        expect(backward?.ingestedAtMs).toBe(forward?.ingestedAtMs);
      }),
    );
  });

  it("lets a cancellation stand however late it arrives", () => {
    fc.assert(
      fc.property(fc.array(reading, { maxLength: 5 }), reading, (earlier, last) => {
        fc.pre(!last.tripCancelled);
        const cancellation = { ...last, tripCancelled: true };
        expect(ingest([...earlier, cancellation])?.tripCancelled).toBe(true);
      }),
    );
  });

  it("keeps a known delay against a rival that also knows one", () => {
    fc.assert(
      fc.property(fc.array(reading, { minLength: 1, maxLength: 6 }), (readings) => {
        fc.pre(readings.every((r) => r.delaySeconds !== null && !r.tripCancelled));
        expect(ingest(readings)?.delaySeconds).not.toBeNull();
      }),
    );
  });
});

/**
 * Where the rule decides by arrival order rather than by evidence. These are
 * characterizations, not endorsements — they exist so the behaviour is visible
 * and a deliberate change to it breaks a test rather than passing silently.
 *
 * Only the third loses information; the first two merely pick arbitrarily
 * between two equally-supported readings.
 */
describe("arbitration ties broken by order", () => {
  const at = (over: Partial<TripStopEvent>) => ({
    delaySeconds: 60,
    scheduledArrival: SCHEDULED,
    ingestedAtMs: SCHEDULED * 1000,
    tripCancelled: false,
    ...over,
  });

  /** Which reading survives when `b` is offered against a stored `a`. */
  const winner = <T extends Parameters<typeof prefersIncomingReading>[0] & Parameters<typeof prefersIncomingReading>[1]>(a: T, b: T): T =>
    prefersIncomingReading(a, b) ? b : a;

  it("takes the last reading when neither has a scheduled arrival", () => {
    const first = at({ scheduledArrival: null, delaySeconds: 60 });
    const second = at({ scheduledArrival: null, delaySeconds: 120 });
    expect(prefersIncomingReading(first, second)).toBe(true);
    expect(prefersIncomingReading(second, first)).toBe(true);
  });

  it("keeps the first reading when both sit equally far from the schedule", () => {
    // `incomingDistance < storedDistance` is strict, so a tie favours whoever
    // arrived first — one poll ten minutes early, one ten minutes late.
    const early = at({ ingestedAtMs: (SCHEDULED - 600) * 1000, delaySeconds: 60 });
    const late = at({ ingestedAtMs: (SCHEDULED + 600) * 1000, delaySeconds: 999 });
    expect(prefersIncomingReading(early, late)).toBe(false);
    expect(prefersIncomingReading(late, early)).toBe(false);
  });

  /**
   * The rule short-circuits on `stored.delaySeconds === null` before it ever
   * measures distance, so a delay-less reading is unbeatable while stored and
   * beatable once it arrives — the same pair, two answers.
   */
  it("treats a delay-less reading differently depending on which side it is on", () => {
    // The delay-less poll is the *closer* of the two to the scheduled time.
    const noDelay = at({ delaySeconds: null, ingestedAtMs: (SCHEDULED - 600) * 1000 });
    const measured = at({ delaySeconds: 120, ingestedAtMs: (SCHEDULED - 900) * 1000 });

    // Stored first, it is displaced by the null short-circuit. Arriving second,
    // it displaces the other on distance. Whoever came last wins — both calls
    // say "take the incoming one", and the two orders keep different readings.
    expect(winner(noDelay, measured)).toBe(measured);
    expect(winner(measured, noDelay)).toBe(noDelay);
  });

  /**
   * The one that loses data. A reading with no scheduled arrival wins
   * unconditionally, so a poll that knows neither the schedule nor the delay
   * erases a delay we had already measured. Worth revisiting: the branch exists
   * to let an unschedulable reading through, but it need not outrank a reading
   * that actually observed something.
   */
  it("lets a schedule-less, delay-less reading erase a measured delay", () => {
    const measured = at({ delaySeconds: 300 });
    const knowsNothing = at({ delaySeconds: null, scheduledArrival: null });
    expect(prefersIncomingReading(measured, knowsNothing)).toBe(true);
  });
});
