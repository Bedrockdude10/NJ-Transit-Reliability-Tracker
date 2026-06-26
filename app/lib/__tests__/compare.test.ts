import { describe, expect, it } from "vitest";
import type { LineMonthlyResponse } from "@njt/shared";
import { buildComparison, fillForward, type CompareInput } from "../compare";

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

const inputs: CompareInput[] = [
  { id: "A", name: "Line A", color: "ff0000", monthly: monthly("A", [["2025-01", 90], ["2025-02", 80]]) },
  { id: "B", name: "Line B", color: null, monthly: monthly("B", [["2025-02", 70], ["2025-03", 60]]) },
];

describe("buildComparison", () => {
  it("unions months ascending across all lines", () => {
    expect(buildComparison(inputs).months).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  it("aligns each line's values to the shared axis, null where missing", () => {
    const { series } = buildComparison(inputs);
    expect(series[0]?.values).toEqual([90, 80, null]);
    expect(series[1]?.values).toEqual([null, 70, 60]);
  });

  it("reports each line's latest published month and average", () => {
    const { series } = buildComparison(inputs);
    expect(series[0]).toMatchObject({ latestMonth: "2025-02", latestOtpPercent: 80, avgOtpPercent: 85 });
    expect(series[1]).toMatchObject({ latestMonth: "2025-03", latestOtpPercent: 60, avgOtpPercent: 65 });
  });

  it("ignores months a line did not publish", () => {
    const sparse = buildComparison([
      { id: "C", name: "C", color: null, monthly: monthly("C", [["2025-01", null], ["2025-02", 50]]) },
    ]);
    expect(sparse.months).toEqual(["2025-02"]);
  });
});

describe("fillForward", () => {
  it("carries the last known value forward and back-fills the lead", () => {
    expect(fillForward([null, 90, null, 80, null])).toEqual([90, 90, 90, 80, 80]);
  });

  it("returns [] when every value is null", () => {
    expect(fillForward([null, null])).toEqual([]);
  });
});
