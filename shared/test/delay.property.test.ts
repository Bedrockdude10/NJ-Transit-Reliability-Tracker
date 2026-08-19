import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DELAY_BUCKETS, OTP_THRESHOLDS_SECONDS } from "../src/constants";
import {
  buildDelayDistribution,
  countOnTimeByThreshold,
  mean,
  otpPercent,
  percentile,
} from "../src/delay";

/**
 * Every number the dashboard shows a rider comes out of these functions, and
 * their inputs are unbounded: a delay is whatever the feed reported, including
 * hours late, negative (early), and zero-length days. Examples cover the shapes
 * someone thought of; these cover the ones nobody did.
 */

/** Delays from an hour early to six hours late, the realistic feed range. */
const delaySeconds = fc.integer({ min: -3600, max: 6 * 3600 });
const delays = fc.array(delaySeconds, { maxLength: 200 });
const nonEmptyDelays = fc.array(delaySeconds, { minLength: 1, maxLength: 200 });

describe("delay distribution properties", () => {
  /**
   * Every delay lands in exactly one bucket. This is really a test of
   * DELAY_BUCKETS itself: a gap between two buckets, or an overlap, shows up
   * here as a total that disagrees with the input length. Editing those
   * boundaries by hand is exactly the kind of change that silently drops trips
   * out of the histogram.
   */
  it("assigns every delay to exactly one bucket", () => {
    fc.assert(
      fc.property(delays, (values) => {
        const distribution = buildDelayDistribution(values);
        const total = Object.values(distribution).reduce((a, b) => a + b, 0);
        expect(total).toBe(values.length);
      }),
    );
  });

  it("always reports every bucket, including empty ones", () => {
    fc.assert(
      fc.property(delays, (values) => {
        // A missing key renders as a hole in the chart rather than a zero bar.
        expect(Object.keys(buildDelayDistribution(values)).sort()).toEqual(
          DELAY_BUCKETS.map((b) => b.label).sort(),
        );
      }),
    );
  });

  it("counts are order-independent", () => {
    fc.assert(
      fc.property(delays, (values) => {
        const reversed = [...values].reverse();
        expect(buildDelayDistribution(reversed)).toEqual(buildDelayDistribution(values));
      }),
    );
  });
});

describe("on-time properties", () => {
  it("keeps OTP within 0 and 100", () => {
    fc.assert(
      fc.property(delays, fc.integer({ min: 0, max: 3600 }), (values, threshold) => {
        const otp = otpPercent(values, threshold);
        expect(otp).toBeGreaterThanOrEqual(0);
        expect(otp).toBeLessThanOrEqual(100);
      }),
    );
  });

  /**
   * A looser threshold can never call fewer trains on time. If this ever fails,
   * the dashboard is showing a line that looks worse at 10 minutes' tolerance
   * than at 5 — nonsense a rider would notice before we did.
   */
  it("is monotonic in the threshold", () => {
    fc.assert(
      fc.property(
        delays,
        fc.integer({ min: 0, max: 1800 }),
        fc.integer({ min: 0, max: 1800 }),
        (values, a, b) => {
          const [tight, loose] = a <= b ? [a, b] : [b, a];
          expect(otpPercent(values, loose)).toBeGreaterThanOrEqual(otpPercent(values, tight));
        },
      ),
    );
  });

  it("counts by threshold agree with the percentage", () => {
    fc.assert(
      fc.property(nonEmptyDelays, (values) => {
        const counts = countOnTimeByThreshold(values);
        for (const threshold of OTP_THRESHOLDS_SECONDS) {
          const fromCount = ((counts[String(threshold)] ?? 0) / values.length) * 100;
          expect(fromCount).toBeCloseTo(otpPercent(values, threshold), 10);
        }
      }),
    );
  });

  it("never counts more on-time trips than there are trips", () => {
    fc.assert(
      fc.property(delays, (values) => {
        for (const count of Object.values(countOnTimeByThreshold(values))) {
          expect(count).toBeLessThanOrEqual(values.length);
          expect(count).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});

describe("summary statistic properties", () => {
  it("bounds the mean by the extremes", () => {
    fc.assert(
      fc.property(nonEmptyDelays, (values) => {
        expect(mean(values)).toBeGreaterThanOrEqual(Math.min(...values));
        expect(mean(values)).toBeLessThanOrEqual(Math.max(...values));
      }),
    );
  });

  it("bounds every percentile by the extremes", () => {
    fc.assert(
      fc.property(nonEmptyDelays, fc.integer({ min: 0, max: 100 }), (values, p) => {
        expect(percentile(values, p)).toBeGreaterThanOrEqual(Math.min(...values));
        expect(percentile(values, p)).toBeLessThanOrEqual(Math.max(...values));
      }),
    );
  });

  it("is monotonic in p", () => {
    fc.assert(
      fc.property(
        nonEmptyDelays,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (values, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(percentile(values, hi)).toBeGreaterThanOrEqual(percentile(values, lo));
        },
      ),
    );
  });

  it("pins p0 to the minimum and p100 to the maximum", () => {
    fc.assert(
      fc.property(nonEmptyDelays, (values) => {
        expect(percentile(values, 0)).toBe(Math.min(...values));
        expect(percentile(values, 100)).toBe(Math.max(...values));
      }),
    );
  });

  it("ignores input order", () => {
    fc.assert(
      fc.property(nonEmptyDelays, fc.integer({ min: 0, max: 100 }), (values, p) => {
        expect(percentile([...values].reverse(), p)).toBeCloseTo(percentile(values, p), 10);
      }),
    );
  });
});
