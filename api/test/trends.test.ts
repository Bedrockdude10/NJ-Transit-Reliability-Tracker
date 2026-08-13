import type { OtpDailyRow } from "@njt/shared";
import { describe, expect, it } from "vitest";
import {
  buildLineTrend,
  classifyTrend,
  MIN_TRIPS_PER_PERIOD,
  SIGNIFICANCE_Z,
  sumPeriod,
  summarizeTrends,
  twoProportionZ,
} from "../src/trends";

describe("twoProportionZ", () => {
  it("is zero when both periods performed identically", () => {
    expect(twoProportionZ(80, 100, 80, 100)).toBe(0);
  });

  it("is negative when the recent period is worse", () => {
    expect(twoProportionZ(60, 100, 90, 100)).toBeLessThan(0);
  });

  // The whole point of a test over a threshold: identical deltas, different
  // confidence, because one line runs far more trains than the other.
  it("scales with sample size, so the same delta is not always news", () => {
    const small = twoProportionZ(8, 10, 9, 10) as number;
    const large = twoProportionZ(800, 1000, 900, 1000) as number;
    expect(Math.abs(small)).toBeLessThan(SIGNIFICANCE_Z);
    expect(Math.abs(large)).toBeGreaterThan(SIGNIFICANCE_Z);
  });

  it("returns null rather than dividing by zero on an empty period", () => {
    expect(twoProportionZ(0, 0, 5, 10)).toBeNull();
    expect(twoProportionZ(5, 10, 0, 0)).toBeNull();
  });

  it("returns null when nothing varied at all", () => {
    // Every train on time in both periods: there is genuinely nothing to report.
    expect(twoProportionZ(100, 100, 100, 100)).toBeNull();
    expect(twoProportionZ(0, 100, 0, 100)).toBeNull();
  });
});

describe("classifyTrend", () => {
  it("calls a large, well-supported drop a worsening", () => {
    expect(classifyTrend(-8, -3, true)).toBe("worsening");
  });

  it("calls a large, well-supported rise an improvement", () => {
    expect(classifyTrend(8, 3, true)).toBe("improving");
  });

  it("refuses to call a change it cannot separate from chance", () => {
    expect(classifyTrend(-8, -1.2, true)).toBe("stable");
  });

  it("refuses to call anything on a thin sample, however big the swing", () => {
    expect(classifyTrend(-40, -5, false)).toBe("stable");
  });
});

describe("buildLineTrend", () => {
  const line = { lineId: "NE", lineName: "Northeast Corridor Line" };

  it("reports both rates and the point difference", () => {
    const t = buildLineTrend({ ...line, recent: { operated: 1000, onTime: 800 }, prior: { operated: 1000, onTime: 900 } });
    expect(t).toMatchObject({ recentOtpPercent: 80, priorOtpPercent: 90, deltaPoints: -10, direction: "worsening" });
  });

  it("marks a line with too few trips as not comparable", () => {
    const thin = MIN_TRIPS_PER_PERIOD - 1;
    const t = buildLineTrend({ ...line, recent: { operated: thin, onTime: 0 }, prior: { operated: 1000, onTime: 900 } });
    expect(t.enoughData).toBe(false);
    expect(t.direction).toBe("stable");
  });

  it("handles a line that ran in neither period without inventing numbers", () => {
    const t = buildLineTrend({ ...line, recent: { operated: 0, onTime: 0 }, prior: { operated: 0, onTime: 0 } });
    expect(t).toMatchObject({ recentOtpPercent: null, priorOtpPercent: null, deltaPoints: null, direction: "stable" });
  });
});

describe("sumPeriod", () => {
  const row = (operated: number, onTime: number): OtpDailyRow =>
    ({
      scope: "line",
      scopeId: "NE",
      serviceDate: "2026-08-13",
      direction: "all",
      tripsOperated: operated,
      tripsCancelled: 0,
      onTimeCounts: { "300": onTime },
      sumDelaySeconds: 0,
    }) as unknown as OtpDailyRow;

  it("totals trips and on-time counts at the chosen threshold", () => {
    expect(sumPeriod([row(100, 80), row(50, 45)], "300")).toEqual({ operated: 150, onTime: 125 });
  });

  it("treats a missing threshold as zero on time, not as zero trips", () => {
    expect(sumPeriod([row(100, 80)], "900")).toEqual({ operated: 100, onTime: 0 });
  });

  it("handles an empty period", () => {
    expect(sumPeriod([], "300")).toEqual({ operated: 0, onTime: 0 });
  });
});

describe("summarizeTrends", () => {
  const trend = (over: Partial<import("@njt/shared").LineTrend>): import("@njt/shared").LineTrend => ({
    lineId: "NE",
    lineName: "Northeast Corridor Line",
    recentOtpPercent: 80,
    priorOtpPercent: 90,
    deltaPoints: -10,
    recentTrips: 1000,
    priorTrips: 1000,
    direction: "worsening",
    enoughData: true,
    ...over,
  });

  it("says when there is nothing comparable yet", () => {
    expect(summarizeTrends([trend({ enoughData: false, direction: "stable" })], 14)).toContain("Not enough data yet");
  });

  it("says plainly when nothing changed", () => {
    expect(summarizeTrends([trend({ direction: "stable" })], 14)).toContain("No line changed measurably");
  });

  it("leads with the worst decline and uses correct grammar for one", () => {
    const s = summarizeTrends([trend({})], 14);
    expect(s).toContain("One line has got measurably worse");
    expect(s).toContain("down 10 points");
  });

  it("counts multiple declines", () => {
    const s = summarizeTrends([trend({}), trend({ lineId: "NC", lineName: "North Jersey Coast Line", deltaPoints: -4 })], 14);
    expect(s).toContain("2 lines have got measurably worse");
    expect(s).toContain("Northeast Corridor Line"); // the steeper of the two
  });

  it("mentions improvement alongside decline", () => {
    const s = summarizeTrends([trend({}), trend({ lineName: "Gladstone Branch", direction: "improving", deltaPoints: 6 })], 14);
    expect(s).toContain("Gladstone Branch improved most, up 6 points");
  });
});
