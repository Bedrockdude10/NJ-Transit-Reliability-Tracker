import { describe, expect, it } from "vitest";
import { PEAK_WINDOWS } from "../src/constants";
import {
  addDays,
  dateRange,
  isPeak,
  localDayOfWeek,
  localHourOfDay,
  parseDateString,
  parseGtfsTimeToSeconds,
  toLocalDateString,
} from "../src/time";

const sec = (utcMs: number) => Math.round(utcMs / 1000);

describe("parseGtfsTimeToSeconds", () => {
  it("parses standard times", () => {
    expect(parseGtfsTimeToSeconds("08:30:00")).toBe(8 * 3600 + 30 * 60);
  });

  it("parses after-midnight times beyond 24h", () => {
    expect(parseGtfsTimeToSeconds("25:30:15")).toBe(25 * 3600 + 30 * 60 + 15);
  });

  it("rejects malformed times", () => {
    expect(() => parseGtfsTimeToSeconds("8:70:00")).toThrow();
    expect(() => parseGtfsTimeToSeconds("nope")).toThrow();
  });
});

describe("local helpers", () => {
  it("formats the local date for an instant", () => {
    // 03:00 UTC on the 16th is still 23:00 EDT on the 15th
    expect(toLocalDateString(sec(Date.UTC(2025, 6, 16, 3, 0, 0)))).toBe("2025-07-15");
  });

  it("reports day of week (Tue = 2)", () => {
    expect(localDayOfWeek(sec(Date.UTC(2025, 6, 15, 16, 0, 0)))).toBe(2);
  });

  it("reports hour of day in local time", () => {
    // 14:00 UTC == 10:00 EDT
    expect(localHourOfDay(sec(Date.UTC(2025, 6, 15, 14, 0, 0)))).toBe(10);
  });
});

describe("isPeak", () => {
  it("is true during a weekday AM peak", () => {
    // 12:00 UTC == 08:00 EDT on a Tuesday
    expect(isPeak(sec(Date.UTC(2025, 6, 15, 12, 0, 0)), PEAK_WINDOWS)).toBe(true);
  });

  it("is false midday on a weekday", () => {
    // 16:00 UTC == 12:00 EDT
    expect(isPeak(sec(Date.UTC(2025, 6, 15, 16, 0, 0)), PEAK_WINDOWS)).toBe(false);
  });

  it("is false on weekends", () => {
    // 2025-07-19 is a Saturday; 12:00 UTC == 08:00 EDT
    expect(isPeak(sec(Date.UTC(2025, 6, 19, 12, 0, 0)), PEAK_WINDOWS)).toBe(false);
  });
});

describe("parseDateString", () => {
  it("parses a valid ISO date", () => {
    expect(parseDateString("2025-01-01")).toEqual({ year: 2025, month: 1, day: 1 });
  });

  it("throws on a non-dashed date", () => {
    expect(() => parseDateString("2025/01/01")).toThrow();
  });
});

describe("date arithmetic", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });

  it("builds an inclusive date range", () => {
    expect(dateRange("2025-07-01", "2025-07-03")).toEqual([
      "2025-07-01",
      "2025-07-02",
      "2025-07-03",
    ]);
  });

  it("returns empty for an inverted range", () => {
    expect(dateRange("2025-07-03", "2025-07-01")).toEqual([]);
  });
});
