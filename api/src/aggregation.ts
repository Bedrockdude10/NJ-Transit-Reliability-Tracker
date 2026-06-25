import {
  DELAY_BUCKETS,
  NJT_OFFICIAL_THRESHOLD_SECONDS,
  OTP_THRESHOLDS_SECONDS,
  type DelayDistributionDailyRow,
  type DistributionBucketResult,
  type HeatmapBucketResult,
  type HeatmapType,
  type NjtOfficialComparison,
  type OfficialNjtMetric,
  type OtpDailyRow,
  type OtpSummary,
  type OtpThresholdResult,
} from "@njt/shared";
import { round1 } from "./util";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function heatmapBucketLabel(type: HeatmapType, bucket: number): string {
  if (type === "day_of_week") return DOW_LABELS[bucket] ?? String(bucket);
  return `${bucket}:00`;
}

/** Turn summed heatmap buckets into labelled average-delay cells. */
export function buildHeatmap(
  buckets: readonly { bucket: number; sumDelaySeconds: number; observations: number }[],
  type: HeatmapType,
): HeatmapBucketResult[] {
  return buckets.map((b) => ({
    bucket: b.bucket,
    label: heatmapBucketLabel(type, b.bucket),
    avgDelaySeconds: b.observations > 0 ? round1(b.sumDelaySeconds / b.observations) : 0,
    observations: b.observations,
  }));
}

export type CountMap = Record<string, number>;

/** Merge `{ key: number }` maps by summing values. */
export function mergeCountMaps(maps: Iterable<CountMap>): CountMap {
  const out: CountMap = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/**
 * Estimate a percentile (0-100) from bucketed delay counts via linear
 * interpolation within the containing bucket. This is an approximation (the
 * raw values aren't retained), suitable for the median/p90 summaries. The
 * open-ended "early" and "60+" buckets are clamped to representative bounds.
 */
export function percentileFromDistribution(counts: CountMap, p: number): number {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const target = (p / 100) * total;
  let cumulative = 0;
  for (const bucket of DELAY_BUCKETS) {
    const count = counts[bucket.label] ?? 0;
    if (count === 0) continue;
    if (cumulative + count >= target) {
      const min = Number.isFinite(bucket.minSeconds) ? bucket.minSeconds : 0;
      const max = bucket.maxSeconds ?? min + 1800;
      const positionInBucket = (target - cumulative) / count;
      return round1(min + positionInBucket * (max - min));
    }
    cumulative += count;
  }
  return 0;
}

export function buildDistributionResult(counts: CountMap): DistributionBucketResult[] {
  return DELAY_BUCKETS.map((bucket) => ({ label: bucket.label, count: counts[bucket.label] ?? 0 }));
}

/** Sum a set of daily OTP + distribution rows into the shared OtpSummary DTO. */
export function buildOtpSummary(
  otpRows: readonly OtpDailyRow[],
  distRows: readonly DelayDistributionDailyRow[],
): OtpSummary {
  const tripsOperated = otpRows.reduce((s, r) => s + r.tripsOperated, 0);
  const tripsCancelled = otpRows.reduce((s, r) => s + r.tripsCancelled, 0);
  const sumDelay = otpRows.reduce((s, r) => s + r.sumDelaySeconds, 0);
  const onTime = mergeCountMaps(otpRows.map((r) => r.onTimeCounts));
  const distCounts = mergeCountMaps(distRows.map((r) => r.counts));

  const thresholds: OtpThresholdResult[] = OTP_THRESHOLDS_SECONDS.map((threshold) => {
    const onTimeTrips = onTime[String(threshold)] ?? 0;
    return {
      thresholdSeconds: threshold,
      thresholdMinutes: threshold / 60,
      otpPercent: tripsOperated > 0 ? round1((onTimeTrips / tripsOperated) * 100) : 0,
      onTimeTrips,
    };
  });

  const scheduled = tripsOperated + tripsCancelled;
  return {
    tripsOperated,
    tripsCancelled,
    cancellationRatePercent: scheduled > 0 ? round1((tripsCancelled / scheduled) * 100) : 0,
    avgDelaySeconds: tripsOperated > 0 ? round1(sumDelay / tripsOperated) : 0,
    medianDelaySeconds: percentileFromDistribution(distCounts, 50),
    p90DelaySeconds: percentileFromDistribution(distCounts, 90),
    thresholds,
    delayDistribution: buildDistributionResult(distCounts),
  };
}

/** Trips-weighted average of NJT's official monthly figures over the period. */
export function buildOfficialComparison(
  metrics: readonly OfficialNjtMetric[],
): NjtOfficialComparison | null {
  if (metrics.length === 0) return null;

  const weightedAverage = (pick: (m: OfficialNjtMetric) => number | null): number | null => {
    let weightSum = 0;
    let valueSum = 0;
    for (const m of metrics) {
      const value = pick(m);
      if (value === null) continue;
      const weight = m.tripsOperated > 0 ? m.tripsOperated : 1;
      weightSum += weight;
      valueSum += value * weight;
    }
    return weightSum > 0 ? round1(valueSum / weightSum) : null;
  };

  return {
    thresholdSeconds: NJT_OFFICIAL_THRESHOLD_SECONDS,
    otpPercent: weightedAverage((m) => m.otpPercent) ?? 0,
    otpPercentAmtrakAdjusted: weightedAverage((m) => m.otpPercentAmtrakAdjusted),
    monthsCovered: new Set(metrics.map((m) => `${m.year}-${m.month}`)).size,
  };
}
