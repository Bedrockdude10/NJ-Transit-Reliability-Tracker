import { describe, expect, it } from "vitest";
import { DELAY_BUCKETS, OTP_THRESHOLDS_SECONDS } from "../src/constants";
import {
  bucketForDelay,
  buildDelayDistribution,
  computeDelaySeconds,
  countOnTimeByThreshold,
  isOnTime,
  mean,
  otpPercent,
  percentile,
} from "../src/delay";

describe("computeDelaySeconds", () => {
  it("is positive when late and negative when early", () => {
    expect(computeDelaySeconds(1000, 1120)).toBe(120);
    expect(computeDelaySeconds(1000, 940)).toBe(-60);
  });
});

describe("isOnTime", () => {
  it("counts exactly-at-threshold as on time", () => {
    expect(isOnTime(300, 300)).toBe(true);
    expect(isOnTime(301, 300)).toBe(false);
    expect(isOnTime(-120, 300)).toBe(true);
  });
});

describe("bucketForDelay", () => {
  it("classifies across the full range", () => {
    expect(bucketForDelay(-60).label).toBe("early");
    expect(bucketForDelay(0).label).toBe("0-5 min");
    expect(bucketForDelay(299).label).toBe("0-5 min");
    expect(bucketForDelay(300).label).toBe("5-10 min");
    expect(bucketForDelay(1000).label).toBe("15-30 min");
    expect(bucketForDelay(7200).label).toBe("60+ min");
  });
});

describe("buildDelayDistribution", () => {
  it("zero-fills every bucket and tallies correctly", () => {
    const dist = buildDelayDistribution([-30, 100, 100, 4000]);
    expect(Object.keys(dist)).toHaveLength(DELAY_BUCKETS.length);
    expect(dist["early"]).toBe(1);
    expect(dist["0-5 min"]).toBe(2);
    expect(dist["60+ min"]).toBe(1);
    expect(dist["30-60 min"]).toBe(0);
  });
});

describe("countOnTimeByThreshold", () => {
  it("counts on-time-or-better trips per threshold", () => {
    // delays: 200s (within all), 700s (within 900+), 5000s (within none)
    const counts = countOnTimeByThreshold([200, 700, 5000]);
    expect(counts["300"]).toBe(1); // only 200s
    expect(counts["900"]).toBe(2); // 200s + 700s
    expect(counts["3600"]).toBe(2); // 200s + 700s, not 5000s
    expect(Object.keys(counts)).toHaveLength(OTP_THRESHOLDS_SECONDS.length);
  });
});

describe("otpPercent", () => {
  it("returns 0 for no trips", () => {
    expect(otpPercent([], 300)).toBe(0);
  });

  it("computes the on-time percentage", () => {
    expect(otpPercent([100, 200, 5000, 6000], 300)).toBe(50);
  });
});

describe("summary stats", () => {
  it("mean handles empty and non-empty", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("percentile interpolates", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40], 90)).toBeCloseTo(37, 5);
  });
});
