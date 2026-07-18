import type { DelayDistributionDailyRow, OtpDailyRow } from "@njt/shared";
import { describe, expect, it } from "vitest";
import {
  averageLightRailOtp,
  buildCancellations,
  buildFleetMdbf,
  buildHeatmap,
  buildOfficialComparison,
  buildOtpSummary,
  mergeCountMaps,
  percentileFromDistribution,
} from "../src/aggregation";

describe("mergeCountMaps", () => {
  it("sums values across maps", () => {
    expect(mergeCountMaps([{ a: 1, b: 2 }, { a: 3, c: 4 }])).toEqual({ a: 4, b: 2, c: 4 });
  });
});

describe("averageLightRailOtp", () => {
  it("returns null with no months and a rounded mean otherwise", () => {
    expect(averageLightRailOtp([])).toBeNull();
    expect(
      averageLightRailOtp([
        { year: 2025, month: 6, otpPercent: 96 },
        { year: 2025, month: 7, otpPercent: 97 },
      ]),
    ).toBe(96.5);
  });
});

describe("percentileFromDistribution", () => {
  it("returns 0 for an empty distribution", () => {
    expect(percentileFromDistribution({}, 50)).toBe(0);
  });

  it("interpolates within the containing bucket", () => {
    // 100 trips all in the 0-5 min bucket [0, 300): p50 -> halfway -> 150s
    expect(percentileFromDistribution({ "0-5 min": 100 }, 50)).toBe(150);
  });

  it("estimates p90 by interpolating within the containing bucket", () => {
    // 100 obs, p90 target = 90. 85 land before "10-15 min" [600, 900), so the
    // target sits 5/10 into it → 600 + 0.5 * (900 - 600) = 750.
    const counts = { early: 10, "0-5 min": 60, "5-10 min": 15, "10-15 min": 10, "15-30 min": 5 };
    expect(percentileFromDistribution(counts, 90)).toBe(750);
  });

  it("clamps the open-ended 60+ bucket (null max) to min + 1800", () => {
    // All mass in "60+ min" (minSeconds 3600, maxSeconds null). p50 target 5/10
    // → 0.5 into a bucket clamped to [3600, 5400): 3600 + 0.5 * 1800 = 4500.
    expect(percentileFromDistribution({ "60+ min": 10 }, 50)).toBe(4500);
  });

  it("clamps the open-ended early bucket (−Infinity min) to 0", () => {
    // "early" has minSeconds −Infinity, maxSeconds 0 → collapses to 0.
    expect(percentileFromDistribution({ early: 10 }, 50)).toBe(0);
  });
});

describe("buildOtpSummary", () => {
  const otp: OtpDailyRow[] = [
    {
      scope: "line",
      scopeId: "NE",
      serviceDate: "2025-07-15",
      direction: "all",
      tripsOperated: 80,
      tripsCancelled: 4,
      onTimeCounts: { "300": 60, "900": 76 },
      sumDelaySeconds: 24000,
    },
    {
      scope: "line",
      scopeId: "NE",
      serviceDate: "2025-07-16",
      direction: "all",
      tripsOperated: 20,
      tripsCancelled: 1,
      onTimeCounts: { "300": 10, "900": 18 },
      sumDelaySeconds: 6000,
    },
  ];
  const dist: DelayDistributionDailyRow[] = [
    { scope: "line", scopeId: "NE", serviceDate: "2025-07-15", counts: { "0-5 min": 80 } },
    { scope: "line", scopeId: "NE", serviceDate: "2025-07-16", counts: { "0-5 min": 20 } },
  ];

  it("sums trips and computes OTP per threshold", () => {
    const summary = buildOtpSummary(otp, dist);
    expect(summary.tripsOperated).toBe(100);
    expect(summary.tripsCancelled).toBe(5);
    expect(summary.cancellationRatePercent).toBeCloseTo((5 / 105) * 100, 1);
    expect(summary.avgDelaySeconds).toBe(300); // 30000 / 100
    const t300 = summary.thresholds.find((t) => t.thresholdSeconds === 300);
    expect(t300?.otpPercent).toBe(70); // 70 on-time of 100
    expect(t300?.onTimeTrips).toBe(70);
  });

  it("zero-fills when there are no trips", () => {
    const summary = buildOtpSummary([], []);
    expect(summary.tripsOperated).toBe(0);
    expect(summary.thresholds.every((t) => t.otpPercent === 0)).toBe(true);
    expect(summary.delayDistribution).toHaveLength(7);
  });
});

describe("buildOfficialComparison", () => {
  it("returns null with no metrics", () => {
    expect(buildOfficialComparison([])).toBeNull();
  });

  it("trips-weights OTP across months", () => {
    const result = buildOfficialComparison([
      { year: 2025, month: 6, lineName: "NEC", otpPercent: 80, otpPercentAmtrakAdjusted: 85, tripsOperated: 100, cancellations: 0, cancellationCauses: null },
      { year: 2025, month: 7, lineName: "NEC", otpPercent: 90, otpPercentAmtrakAdjusted: null, tripsOperated: 300, cancellations: 0, cancellationCauses: null },
    ]);
    // (80*100 + 90*300) / 400 = 87.5
    expect(result?.otpPercent).toBe(87.5);
    expect(result?.otpPercentAmtrakAdjusted).toBe(85); // only one month reports it
    expect(result?.monthsCovered).toBe(2);
    expect(result?.thresholdSeconds).toBe(360);
  });

  it("sums real NJT operations totals and computes a cancellation rate", () => {
    const result = buildOfficialComparison([
      { year: 2025, month: 6, lineName: "NEC", otpPercent: 80, otpPercentAmtrakAdjusted: null, tripsOperated: 190, cancellations: 10, cancellationCauses: null },
      { year: 2025, month: 7, lineName: "NEC", otpPercent: 90, otpPercentAmtrakAdjusted: null, tripsOperated: 290, cancellations: 10, cancellationCauses: null },
    ]);
    expect(result?.tripsOperated).toBe(480);
    expect(result?.cancellations).toBe(20);
    // 20 / (480 + 20) = 4%
    expect(result?.cancellationRatePercent).toBe(4);
  });
});

describe("buildCancellations", () => {
  it("returns null with no metrics", () => {
    expect(buildCancellations([])).toBeNull();
  });

  it("sums totals and ranks causes by share", () => {
    const result = buildCancellations([
      { year: 2025, month: 6, lineName: "NEC", otpPercent: 80, otpPercentAmtrakAdjusted: null, tripsOperated: 100, cancellations: 10, cancellationCauses: { AMTRAK: 6, Mechanical: 4 } },
      { year: 2025, month: 7, lineName: "NEC", otpPercent: 90, otpPercentAmtrakAdjusted: null, tripsOperated: 100, cancellations: 10, cancellationCauses: { AMTRAK: 4, Mechanical: 6 } },
    ]);
    expect(result?.total).toBe(20);
    expect(result?.byCause[0]).toEqual({ cause: "AMTRAK", count: 10, percent: 50 });
    expect(result?.monthsCovered).toBe(2);
  });
});

describe("buildFleetMdbf", () => {
  it("averages monthly MDBF and counts months", () => {
    expect(
      buildFleetMdbf([
        { year: 2025, month: 6, mdbf: 80000 },
        { year: 2025, month: 7, mdbf: 90000 },
      ]),
    ).toEqual({ avgMiles: 85000, monthsCovered: 2 });
    expect(buildFleetMdbf([])).toBeNull();
  });
});

describe("buildHeatmap", () => {
  it("labels day-of-week buckets and averages delay", () => {
    const cells = buildHeatmap([{ bucket: 2, sumDelaySeconds: 600, observations: 10 }], "day_of_week");
    expect(cells[0]).toEqual({ bucket: 2, label: "Tue", avgDelaySeconds: 60, observations: 10 });
  });
});
