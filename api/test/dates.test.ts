import { describe, expect, it } from "vitest";
import { ApiError } from "../src/util";
import { monthRange, resolveRange } from "../src/dates";

const NOW = Date.UTC(2025, 6, 20, 16, 0, 0); // 2025-07-20 noon EDT

describe("resolveRange", () => {
  it("defaults to a trailing 30-day window ending today (NJT local)", () => {
    const range = resolveRange(undefined, undefined, NOW);
    expect(range.to).toBe("2025-07-20");
    expect(range.from).toBe("2025-06-21");
  });

  it("accepts explicit dates", () => {
    expect(resolveRange("2025-01-01", "2025-01-31", NOW)).toEqual({ from: "2025-01-01", to: "2025-01-31" });
  });

  it("rejects malformed dates", () => {
    expect(() => resolveRange("2025/01/01", undefined, NOW)).toThrow(ApiError);
  });

  it("rejects impossible calendar dates", () => {
    expect(() => resolveRange("2024-13-01", undefined, NOW)).toThrow(ApiError); // month 13
    expect(() => resolveRange("2024-00-10", undefined, NOW)).toThrow(ApiError); // month 0
    expect(() => resolveRange("2024-13-45", undefined, NOW)).toThrow(ApiError); // both out of range
    expect(() => resolveRange("2025-02-29", undefined, NOW)).toThrow(ApiError); // not a leap year
    expect(() => resolveRange("2025-04-31", undefined, NOW)).toThrow(ApiError); // April has 30 days
    expect(() => resolveRange("2025-01-00", undefined, NOW)).toThrow(ApiError); // day 0
  });

  it("accepts valid leap-day and month-end dates", () => {
    expect(resolveRange("2024-02-29", "2024-03-31", NOW)).toEqual({ from: "2024-02-29", to: "2024-03-31" });
  });

  it("rejects an inverted range", () => {
    expect(() => resolveRange("2025-02-01", "2025-01-01", NOW)).toThrow(ApiError);
  });
});

describe("monthRange", () => {
  it("derives the inclusive month bounds", () => {
    expect(monthRange({ from: "2025-01-15", to: "2025-03-02" })).toEqual({
      from: { year: 2025, month: 1 },
      to: { year: 2025, month: 3 },
    });
  });
});
