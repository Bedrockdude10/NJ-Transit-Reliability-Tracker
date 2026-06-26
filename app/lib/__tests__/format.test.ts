import { describe, expect, it } from "vitest";
import { formatDelaySeconds, formatMonth, formatPercent, formatShortDate, humanizeEffect } from "../format";

describe("formatDelaySeconds", () => {
  it("formats late, early, on-time, and unknown", () => {
    expect(formatDelaySeconds(150)).toBe("2m 30s late");
    expect(formatDelaySeconds(120)).toBe("2m late");
    expect(formatDelaySeconds(-90)).toBe("1m 30s early");
    expect(formatDelaySeconds(10)).toBe("on time");
    expect(formatDelaySeconds(null)).toBe("—");
  });
});

describe("date + misc formatters", () => {
  it("formats dates and percentages", () => {
    expect(formatShortDate("2025-07-15")).toBe("Jul 15");
    expect(formatMonth("2025-07-15")).toBe("Jul 2025");
    expect(formatPercent(88.5)).toBe("88.5%");
    expect(formatPercent(null)).toBe("—");
    expect(humanizeEffect("reduced_service")).toBe("Reduced service");
  });
});
