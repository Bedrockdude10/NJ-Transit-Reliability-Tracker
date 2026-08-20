import {
  DELAY_BUCKETS,
  NJT_OFFICIAL_THRESHOLD_SECONDS,
  OTP_THRESHOLDS_SECONDS,
  monthIndex,
  monthKey,
  type AnnualOtpYear,
  type CancellationCauseResult,
  type DelayDistributionDailyRow,
  type DistributionBucketResult,
  type FleetMdbf,
  type FleetMdbfMetric,
  type HeatmapBucketResult,
  type HeatmapType,
  type LightRailOtpMetric,
  type NjtCancellations,
  type NjtOfficialComparison,
  type OfficialCoverage,
  type OfficialNjtMetric,
  type OtpDailyRow,
  type OtpSummary,
  type OtpThresholdResult,
  type SeasonalityMonth,
} from "@njt/shared";
import { round1 } from "./util";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Key into `on_time_counts`, which is keyed by threshold seconds. */
export const ON_TIME_15_MIN = "900";

export function averageLightRailOtp(rows: readonly LightRailOtpMetric[]): number | null {
  if (rows.length === 0) return null;
  return round1(rows.reduce((s, r) => s + r.otpPercent, 0) / rows.length);
}

export function heatmapBucketLabel(type: HeatmapType, bucket: number): string {
  if (type === "day_of_week") return DOW_LABELS[bucket] ?? String(bucket);
  return `${bucket}:00`;
}

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
 * Approximate, not exact: raw delays aren't retained, so this interpolates within
 * the containing bucket and clamps the open-ended "early" / "60+" buckets.
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

/**
 * Exact percentile over raw values, by nearest rank. Unlike
 * {@link percentileFromDistribution} nothing is bucketed here, so a record built
 * from individual runs reports the run it actually had.
 */
export function percentileOf(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? null;
}

export function buildDistributionResult(counts: CountMap): DistributionBucketResult[] {
  return DELAY_BUCKETS.map((bucket) => ({ label: bucket.label, count: counts[bucket.label] ?? 0 }));
}

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

  const tripsOperated = metrics.reduce((s, m) => s + m.tripsOperated, 0);
  const cancellations = metrics.reduce((s, m) => s + m.cancellations, 0);
  const scheduled = tripsOperated + cancellations;
  return {
    thresholdSeconds: NJT_OFFICIAL_THRESHOLD_SECONDS,
    otpPercent: weightedAverage((m) => m.otpPercent) ?? 0,
    otpPercentAmtrakAdjusted: weightedAverage((m) => m.otpPercentAmtrakAdjusted),
    monthsCovered: new Set(metrics.map((m) => monthKey(m.year, m.month))).size,
    tripsOperated,
    cancellations,
    cancellationRatePercent: scheduled > 0 ? round1((cancellations / scheduled) * 100) : 0,
  };
}

export function buildCancellations(metrics: readonly OfficialNjtMetric[]): NjtCancellations | null {
  if (metrics.length === 0) return null;
  const total = metrics.reduce((s, m) => s + m.cancellations, 0);
  const merged = mergeCountMaps(metrics.map((m) => m.cancellationCauses ?? {}));
  const byCause: CancellationCauseResult[] = Object.entries(merged)
    .map(([cause, count]) => ({ cause, count, percent: total > 0 ? round1((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  return { total, byCause, monthsCovered: new Set(metrics.map((m) => monthKey(m.year, m.month))).size };
}

export function buildFleetMdbf(rows: readonly FleetMdbfMetric[]): FleetMdbf | null {
  if (rows.length === 0) return null;
  const avg = rows.reduce((s, r) => s + r.mdbf, 0) / rows.length;
  return { avgMiles: Math.round(avg), monthsCovered: rows.length };
}

function weightedOtpByKey(
  metrics: readonly OfficialNjtMetric[],
  keyOf: (m: OfficialNjtMetric) => number,
): Map<number, { weight: number; valueSum: number; spans: Set<number> }> {
  const by = new Map<number, { weight: number; valueSum: number; spans: Set<number> }>();
  for (const m of metrics) {
    const key = keyOf(m);
    const acc = by.get(key) ?? { weight: 0, valueSum: 0, spans: new Set<number>() };
    const w = m.tripsOperated > 0 ? m.tripsOperated : 1;
    acc.weight += w;
    acc.valueSum += m.otpPercent * w;
    acc.spans.add(monthIndex(m.year, m.month));
    by.set(key, acc);
  }
  return by;
}

export function buildSeasonality(metrics: readonly OfficialNjtMetric[]): SeasonalityMonth[] {
  const by = weightedOtpByKey(metrics, (m) => m.month);
  const out: SeasonalityMonth[] = [];
  for (let month = 1; month <= 12; month++) {
    const acc = by.get(month);
    out.push({
      month,
      avgOtpPercent: acc && acc.weight > 0 ? round1(acc.valueSum / acc.weight) : null,
      years: acc ? acc.spans.size : 0,
    });
  }
  return out;
}

export function buildAnnualOtp(metrics: readonly OfficialNjtMetric[]): AnnualOtpYear[] {
  const by = weightedOtpByKey(metrics, (m) => m.year);
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, acc]) => ({
      year,
      avgOtpPercent: acc.weight > 0 ? round1(acc.valueSum / acc.weight) : null,
      months: acc.spans.size,
    }));
}

export function buildMdbfAnnual(rows: readonly FleetMdbfMetric[]): { year: number; avgMdbf: number }[] {
  const by = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    const acc = by.get(r.year) ?? { sum: 0, n: 0 };
    acc.sum += r.mdbf;
    acc.n += 1;
    by.set(r.year, acc);
  }
  return [...by.entries()].sort(([a], [b]) => a - b).map(([year, acc]) => ({ year, avgMdbf: Math.round(acc.sum / acc.n) }));
}

export function buildOfficialCoverage(metrics: readonly OfficialNjtMetric[]): OfficialCoverage[] {
  const byLine = new Map<string, number[]>();
  for (const m of metrics) {
    const list = byLine.get(m.lineName) ?? [];
    list.push(monthIndex(m.year, m.month));
    byLine.set(m.lineName, list);
  }
  const fmt = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  return [...byLine.entries()]
    .map(([lineName, idxs]) => {
      const present = new Set(idxs);
      const min = Math.min(...idxs);
      const max = Math.max(...idxs);
      const missingMonths: string[] = [];
      for (let i = min; i <= max; i++) if (!present.has(i)) missingMonths.push(fmt(i));
      return {
        lineName,
        firstMonth: fmt(min),
        lastMonth: fmt(max),
        monthsPresent: present.size,
        monthsExpected: max - min + 1,
        missingMonths,
      };
    })
    .sort((a, b) => b.missingMonths.length - a.missingMonths.length || a.lineName.localeCompare(b.lineName));
}
