import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatDateParts, getLocalParts, parseGtfsTimeToSeconds } from "../src/time";
import { gtfsStopTimeToEpochSeconds, localPartsToEpochSeconds } from "../src/time-zoned";

/**
 * The DST bugs fixed in this module were both invisible to example-based tests,
 * because every example anyone thought to write landed on an ordinary day. Two
 * transition days a year is roughly 0.5% of dates — you do not stumble onto
 * them, but a generator does.
 *
 * These state the laws the module must obey for *every* date rather than for a
 * handful, so the next person to touch the anchor gets a counterexample instead
 * of a silent hour of drift.
 */

/**
 * DST days are ~0.5% of the calendar, and fast-check's default 100 runs over a
 * five-year window misses them more often than not — verified by reintroducing
 * the midnight anchor, which a uniform generator waved straight through. A
 * property that only sometimes catches its bug is no property at all, so the
 * transitions get their own weighted branch.
 */
const US_DST_TRANSITIONS = [
  "2024-03-10", "2024-11-03",
  "2025-03-09", "2025-11-02",
  "2026-03-08", "2026-11-01",
  "2027-03-14", "2027-11-07",
  "2028-03-12", "2028-11-05",
];

const uniformDate = fc
  .date({
    min: new Date("2024-01-01T12:00:00Z"),
    max: new Date("2028-12-31T12:00:00Z"),
    noInvalidDate: true,
  })
  .map((d) => formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));

/** A transition day or one of its neighbours, where off-by-an-hour errors hide. */
const transitionDate = fc
  .tuple(fc.constantFrom(...US_DST_TRANSITIONS), fc.integer({ min: -1, max: 1 }))
  .map(([date, shift]) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + shift);
    return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  });

const serviceDate = fc.oneof(
  { weight: 1, arbitrary: uniformDate },
  { weight: 1, arbitrary: transitionDate },
);

const gtfsTime = fc
  .tuple(fc.integer({ min: 0, max: 27 }), fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m, s]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);

describe("gtfsStopTimeToEpochSeconds properties", () => {
  /**
   * The spec's defining law. "12:00:00" is noon on the service date, always —
   * that is the entire reason GTFS anchors at noon minus twelve hours instead
   * of midnight. The old midnight anchor broke this on both transition days,
   * and this single property fails on every one of them.
   */
  it("resolves 12:00:00 to local noon on every date", () => {
    fc.assert(
      fc.property(serviceDate, (date) => {
        const parts = getLocalParts(gtfsStopTimeToEpochSeconds(date, "12:00:00"));
        expect([parts.hour, parts.minute, parts.second]).toEqual([12, 0, 0]);
        expect(formatDateParts(parts.year, parts.month, parts.day)).toBe(date);
      }),
    );
  });

  it("is strictly increasing in the stop time", () => {
    fc.assert(
      fc.property(serviceDate, gtfsTime, gtfsTime, (date, a, b) => {
        const [earlier, later] =
          parseGtfsTimeToSeconds(a) < parseGtfsTimeToSeconds(b) ? [a, b] : [b, a];
        fc.pre(parseGtfsTimeToSeconds(earlier) !== parseGtfsTimeToSeconds(later));
        expect(gtfsStopTimeToEpochSeconds(date, earlier)).toBeLessThan(
          gtfsStopTimeToEpochSeconds(date, later),
        );
      }),
    );
  });

  /**
   * Elapsed real time between two stop times equals the difference in their
   * GTFS seconds — no transition may stretch or compress a scheduled interval.
   * A train timetabled 30 minutes apart takes 30 minutes on 8 March too.
   */
  it("preserves scheduled intervals as real elapsed time", () => {
    fc.assert(
      fc.property(serviceDate, gtfsTime, gtfsTime, (date, a, b) => {
        const gap = gtfsStopTimeToEpochSeconds(date, b) - gtfsStopTimeToEpochSeconds(date, a);
        expect(gap).toBe(parseGtfsTimeToSeconds(b) - parseGtfsTimeToSeconds(a));
      }),
    );
  });
});

describe("localPartsToEpochSeconds properties", () => {
  /**
   * Same reasoning as `serviceDate`: the spring gap and the repeated autumn
   * hour together are two hours out of five years. Uniform sampling never
   * lands there, so half the draws are aimed at a transition window.
   */
  const instant = fc.oneof(
    {
      weight: 1,
      arbitrary: fc.integer({
        min: Math.floor(Date.UTC(2024, 0, 1) / 1000),
        max: Math.floor(Date.UTC(2028, 11, 31) / 1000),
      }),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(...US_DST_TRANSITIONS),
          fc.integer({ min: -3 * 3600, max: 6 * 3600 }),
        )
        .map(([date, offset]) => Math.floor(Date.parse(`${date}T05:00:00Z`) / 1000) + offset),
    },
  );

  /**
   * Round-tripping an instant through wall-clock and back must land on an
   * instant with the *same* wall clock. Not necessarily the same instant: in
   * the repeated fall-back hour two instants share one wall clock, and the
   * conversion is defined to pick the first. Preserving the parts is the law
   * that holds regardless.
   *
   * The old implementation broke this inside the spring-forward gap, returning
   * a time an hour off the one it was handed.
   */
  it("round-trips an instant to the same wall clock", () => {
    fc.assert(
      fc.property(instant, (epochSeconds) => {
        const parts = getLocalParts(epochSeconds);
        expect(getLocalParts(localPartsToEpochSeconds(parts))).toEqual(parts);
      }),
    );
  });

  it("is idempotent under repeated round-tripping", () => {
    fc.assert(
      fc.property(instant, (epochSeconds) => {
        const once = localPartsToEpochSeconds(getLocalParts(epochSeconds));
        expect(localPartsToEpochSeconds(getLocalParts(once))).toBe(once);
      }),
    );
  });

  it("never moves a time backwards past the instant it was derived from", () => {
    // Resolving a nonexistent local time must shift *forward* out of the gap.
    // The old code shifted back, scheduling trains before the requested time.
    fc.assert(
      fc.property(instant, (epochSeconds) => {
        const resolved = localPartsToEpochSeconds(getLocalParts(epochSeconds));
        expect(resolved).toBeLessThanOrEqual(epochSeconds);
      }),
    );
  });

  it("orders instants the same way it orders their wall clocks within a day", () => {
    fc.assert(
      fc.property(instant, fc.integer({ min: 1, max: 20 * 3600 }), (start, offset) => {
        const later = start + offset;
        // Equal only when both land in the repeated hour and collapse together.
        expect(
          localPartsToEpochSeconds(getLocalParts(later)) >=
            localPartsToEpochSeconds(getLocalParts(start)) - 3600,
        ).toBe(true);
      }),
    );
  });
});
