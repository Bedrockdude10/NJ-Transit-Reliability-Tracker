import { describe, expect, it } from "vitest";
import { getLocalParts } from "../src/time";
import {
  gtfsStopTimeToEpochSeconds,
  localPartsToEpochSeconds,
  startOfLocalDayEpochSeconds,
} from "../src/time-zoned";

const sec = (utcMs: number) => Math.round(utcMs / 1000);

describe("gtfsStopTimeToEpochSeconds", () => {
  it("resolves a summer (EDT, UTC-4) stop time", () => {
    // 08:30 EDT == 12:30 UTC
    expect(gtfsStopTimeToEpochSeconds("2025-07-15", "08:30:00")).toBe(
      sec(Date.UTC(2025, 6, 15, 12, 30, 0)),
    );
  });

  it("resolves a winter (EST, UTC-5) stop time", () => {
    // 08:30 EST == 13:30 UTC
    expect(gtfsStopTimeToEpochSeconds("2025-01-15", "08:30:00")).toBe(
      sec(Date.UTC(2025, 0, 15, 13, 30, 0)),
    );
  });

  it("rolls after-midnight times onto the next calendar day", () => {
    // 25:30 on the 2025-07-15 service date == 01:30 EDT on the 16th == 05:30 UTC
    expect(gtfsStopTimeToEpochSeconds("2025-07-15", "25:30:00")).toBe(
      sec(Date.UTC(2025, 6, 16, 5, 30, 0)),
    );
  });

  it("memoizes local midnight per service date without cross-date leakage", () => {
    // Repeated resolutions on the same date share the cached midnight anchor and
    // stay exact for every offset; distinct dates keep independent anchors.
    for (let i = 0; i < 3; i++) {
      expect(gtfsStopTimeToEpochSeconds("2025-07-15", "08:30:00")).toBe(
        sec(Date.UTC(2025, 6, 15, 12, 30, 0)),
      );
      expect(gtfsStopTimeToEpochSeconds("2025-07-15", "23:59:59")).toBe(
        sec(Date.UTC(2025, 6, 16, 3, 59, 59)),
      );
    }
    // A winter date (EST, UTC-5) resolved after the summer one must not reuse
    // the summer offset — a regression guard for the midnight cache key.
    expect(gtfsStopTimeToEpochSeconds("2025-01-15", "08:30:00")).toBe(
      sec(Date.UTC(2025, 0, 15, 13, 30, 0)),
    );
  });
});

describe("localPartsToEpochSeconds", () => {
  it("round-trips through getLocalParts (EDT and EST)", () => {
    const summer = { year: 2025, month: 7, day: 15, hour: 8, minute: 30, second: 0 };
    // 08:30 EDT == 12:30 UTC.
    const summerEpoch = localPartsToEpochSeconds(summer);
    expect(summerEpoch).toBe(sec(Date.UTC(2025, 6, 15, 12, 30, 0)));
    expect(getLocalParts(summerEpoch)).toEqual(summer);

    const winter = { year: 2025, month: 1, day: 15, hour: 8, minute: 30, second: 0 };
    // 08:30 EST == 13:30 UTC.
    const winterEpoch = localPartsToEpochSeconds(winter);
    expect(winterEpoch).toBe(sec(Date.UTC(2025, 0, 15, 13, 30, 0)));
    expect(getLocalParts(winterEpoch)).toEqual(winter);
  });
});

/**
 * Daylight saving. Two distinct bugs lived here, and the file's own comments
 * pointed at the wrong one — it claimed the fall-back hour was mishandled when
 * fall-back was in fact correct.
 *
 * The real defects: nonexistent spring-forward times resolved an hour early,
 * and — much larger — GTFS stop times were anchored at local midnight instead
 * of the spec's noon-minus-twelve-hours, which shifted *every* stop time on
 * both transition days by an hour. That silently corrupts every delay measured
 * on those two days a year.
 */
describe("daylight saving", () => {
  const wallClock = (epochSeconds: number) => {
    const p = getLocalParts(epochSeconds);
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  };

  describe("GTFS stop times anchor at noon minus 12h, not local midnight", () => {
    // 2026-03-08 loses an hour at 02:00; 2026-11-01 repeats 01:00-02:00.
    const cases: Array<[string, string]> = [
      ["2026-03-08", "spring forward"],
      ["2026-11-01", "fall back"],
      ["2026-08-13", "ordinary day"],
    ];

    for (const [date, label] of cases) {
      it(`keeps scheduled wall-clock times intact on a ${label}`, () => {
        // A midnight anchor read 08:00 as 09:00 in spring and 07:00 in autumn.
        expect(wallClock(gtfsStopTimeToEpochSeconds(date, "08:00:00"))).toBe("08:00");
        expect(wallClock(gtfsStopTimeToEpochSeconds(date, "17:30:00"))).toBe("17:30");
        expect(wallClock(gtfsStopTimeToEpochSeconds(date, "25:30:00"))).toBe("01:30");
      });
    }

    /**
     * The anchor's own wall-clock slides on a transition day — that slide is
     * precisely what keeps the rest of the day correct. It is also the spec's
     * one uncomfortable consequence: stop times in the small hours of a
     * transition day land an hour off local midnight. That is what the feed
     * producer encoded, so it is what we must decode.
     */
    it("anchors spring-forward day at 23:00 the previous evening", () => {
      const p = getLocalParts(gtfsStopTimeToEpochSeconds("2026-03-08", "00:00:00"));
      expect([p.day, p.hour]).toEqual([7, 23]);
    });

    it("anchors fall-back day at 01:00", () => {
      const p = getLocalParts(gtfsStopTimeToEpochSeconds("2026-11-01", "00:00:00"));
      expect([p.day, p.hour]).toEqual([1, 1]);
    });

    it("keeps local calendar days 23 and 25 hours long", () => {
      const span = (a: string, b: string) =>
        (startOfLocalDayEpochSeconds(b) - startOfLocalDayEpochSeconds(a)) / 3600;
      expect(span("2026-03-08", "2026-03-09")).toBe(23);
      expect(span("2026-11-01", "2026-11-02")).toBe(25);
      expect(span("2026-08-13", "2026-08-14")).toBe(24);
    });
  });

  describe("local parts to instant", () => {
    it("resolves a time inside the fall-back hour to its first occurrence", () => {
      // 01:30 happens twice on 2026-11-01: 05:30Z (EDT) then 06:30Z (EST).
      const e = localPartsToEpochSeconds({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 });
      expect(e).toBe(sec(Date.UTC(2026, 10, 1, 5, 30)));
      expect(wallClock(e)).toBe("01:30");
    });

    it("shifts a nonexistent spring-forward time forward past the gap", () => {
      // 02:30 does not exist on 2026-03-08. It used to resolve an hour early
      // and read back as 01:30, placing a train before the time it was asked
      // for; the correct answer is to land after the gap.
      const e = localPartsToEpochSeconds({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 });
      expect(wallClock(e)).toBe("03:30");
      expect(e).toBeGreaterThan(
        localPartsToEpochSeconds({ year: 2026, month: 3, day: 8, hour: 1, minute: 59, second: 0 }),
      );
    });

    it("round-trips every real local time on both transition days", () => {
      for (const [y, m, d] of [[2026, 3, 8], [2026, 11, 1]] as const) {
        for (let hour = 0; hour < 24; hour++) {
          // 02:00-02:59 is the gap on spring-forward day: no instant maps to it.
          if (m === 3 && hour === 2) continue;
          const e = localPartsToEpochSeconds({ year: y, month: m, day: d, hour, minute: 15, second: 0 });
          expect(wallClock(e)).toBe(`${String(hour).padStart(2, "0")}:15`);
        }
      }
    });
  });
});
