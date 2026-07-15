import { describe, expect, it } from "vitest";
import type { LineMonthlyResponse } from "@njt/shared";
import { buildComparison, type CompareInput } from "../compare";
import { formatMonth, formatShortDate } from "../format";

function monthly(id: string, rows: [string, number | null][]): LineMonthlyResponse {
  return {
    lineId: id,
    name: id,
    rows: rows.map(([month, njtOtpPercent]) => ({
      month,
      njtOtpPercent,
      njtOtpPercentAmtrakAdjusted: null,
      projectOtpPercent15Min: null,
      projectTripsOperated: 0,
    })),
  };
}

describe("buildComparison — line with no published OTP", () => {
  it("emits null latest/average when a selected line published nothing", () => {
    const inputs: CompareInput[] = [
      { id: "A", name: "Line A", color: null, monthly: monthly("A", [["2025-01", 90]]) },
      // B has rows but all null → contributes no months, empty present array.
      { id: "B", name: "Line B", color: null, monthly: monthly("B", [["2025-01", null]]) },
    ];
    const { series } = buildComparison(inputs);
    const b = series.find((s) => s.id === "B");
    expect(b).toMatchObject({ latestMonth: null, latestOtpPercent: null, avgOtpPercent: null });
    expect(b?.values).toEqual([null]); // aligned to A's single month
  });
});

describe("format — malformed / edge inputs", () => {
  it("returns the raw string when a month string is malformed", () => {
    expect(formatMonth("garbage")).toBe("garbage");
  });

  it("renders '?' for an out-of-range month index", () => {
    expect(formatShortDate("2025-13-01")).toBe("? 1");
    expect(formatMonth("2025-00")).toBe("? 2025");
  });
});
