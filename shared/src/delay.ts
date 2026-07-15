/**
 * Pure delay math: computing delay, classifying on-time at a threshold, and
 * bucketing delays into the distribution used by the dashboard histograms.
 */

import { DELAY_BUCKETS, OTP_THRESHOLDS_SECONDS, type DelayBucket } from "./constants";

/**
 * Delay in seconds from scheduled vs observed instants (epoch seconds).
 * Positive = late, negative = early.
 */
export function computeDelaySeconds(
  scheduledEpochSeconds: number,
  observedEpochSeconds: number,
): number {
  return observedEpochSeconds - scheduledEpochSeconds;
}

/**
 * On-time at a given threshold. A train is "on time" if it is no more than
 * `thresholdSeconds` late. Arriving early always counts as on time.
 */
export function isOnTime(delaySeconds: number, thresholdSeconds: number): boolean {
  return delaySeconds <= thresholdSeconds;
}

/** Find the distribution bucket a delay falls into. Never returns undefined. */
export function bucketForDelay(delaySeconds: number): DelayBucket {
  for (const bucket of DELAY_BUCKETS) {
    const aboveMin = delaySeconds >= bucket.minSeconds;
    const belowMax = bucket.maxSeconds === null || delaySeconds < bucket.maxSeconds;
    if (aboveMin && belowMax) return bucket;
  }
  // Unreachable given the buckets span (-inf, +inf), but keep types honest.
  return DELAY_BUCKETS[DELAY_BUCKETS.length - 1] as DelayBucket;
}

/** Tally a list of delays into `{ bucketLabel: count }`, zero-filled. */
export function buildDelayDistribution(
  delaysSeconds: readonly number[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bucket of DELAY_BUCKETS) counts[bucket.label] = 0;
  for (const delay of delaysSeconds) {
    const label = bucketForDelay(delay).label;
    counts[label] = counts[label]! + 1;
  }
  return counts;
}

/**
 * Count, for each configured threshold, how many of the delays are on-time-or-
 * better. Returns `{ thresholdSeconds: count }` keyed by string for JSON safety.
 */
export function countOnTimeByThreshold(
  delaysSeconds: readonly number[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const threshold of OTP_THRESHOLDS_SECONDS) counts[String(threshold)] = 0;
  for (const delay of delaysSeconds) {
    for (const threshold of OTP_THRESHOLDS_SECONDS) {
      if (isOnTime(delay, threshold)) {
        counts[String(threshold)] = (counts[String(threshold)] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/** On-time percentage (0-100) at a threshold; 0 when there are no trips. */
export function otpPercent(
  delaysSeconds: readonly number[],
  thresholdSeconds: number,
): number {
  if (delaysSeconds.length === 0) return 0;
  const onTime = delaysSeconds.filter((d) => isOnTime(d, thresholdSeconds)).length;
  return (onTime / delaysSeconds.length) * 100;
}

/** Arithmetic mean; 0 for an empty list. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Linear-interpolated percentile (0-100). Returns 0 for an empty list. Used for
 * median/p90 delay summaries.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowVal = sorted[low] as number;
  if (low === high) return lowVal;
  const highVal = sorted[high] as number;
  return lowVal + (highVal - lowVal) * (rank - low);
}
