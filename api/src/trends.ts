import type { OtpDailyRow } from "@njt/shared";
import type { LineTrend, TrendDirection } from "@njt/shared";
import { round1 } from "./util";

/**
 * Detect which lines have actually changed, rather than which ones happen to
 * look different this fortnight.
 *
 * Comparing two on-time rates is easy; knowing whether the difference means
 * anything is the hard part, and getting it wrong turns a reliability tool into
 * a rumour mill. A fixed threshold ("flag anything over 3 points") can't tell a
 * real shift on a busy line from noise on a quiet one, so this screens with a
 * two-proportion z-test instead: the same delta is called on the Northeast
 * Corridor and withheld on the Princeton Shuttle, which is the correct
 * behaviour.
 *
 * The test assumes independent trials. Trains on the same day share weather,
 * crew and infrastructure, so they are *not* independent, and the test will
 * therefore flag slightly more often than its nominal 5%. It is used here as a
 * screen — "worth looking at" — not as proof, and the UI says so.
 */

/** Two-sided z for a difference in proportions. Null when either side is empty. */
export function twoProportionZ(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number,
): number | null {
  if (totalA <= 0 || totalB <= 0) return null;
  const pA = successesA / totalA;
  const pB = successesB / totalB;
  const pooled = (successesA + successesB) / (totalA + totalB);
  // A pooled rate at either extreme leaves no variance to divide by; with every
  // train on time in both periods there is, correctly, nothing to report.
  const variance = pooled * (1 - pooled) * (1 / totalA + 1 / totalB);
  if (variance <= 0) return null;
  return (pA - pB) / Math.sqrt(variance);
}

/** |z| beyond this is conventionally "unlikely to be chance" at p < 0.05. */
export const SIGNIFICANCE_Z = 1.96;

/** Below this many trips in either period, a rate is not worth comparing. */
export const MIN_TRIPS_PER_PERIOD = 50;

export interface PeriodTotals {
  operated: number;
  onTime: number;
}

export function sumPeriod(rows: readonly OtpDailyRow[], threshold: string): PeriodTotals {
  let operated = 0;
  let onTime = 0;
  for (const r of rows) {
    operated += r.tripsOperated;
    onTime += r.onTimeCounts[threshold] ?? 0;
  }
  return { operated, onTime };
}

export function classifyTrend(deltaPoints: number, z: number | null, enoughData: boolean): TrendDirection {
  if (!enoughData || z === null || Math.abs(z) < SIGNIFICANCE_Z) return "stable";
  return deltaPoints > 0 ? "improving" : "worsening";
}

export function buildLineTrend(input: {
  lineId: string;
  lineName: string;
  recent: PeriodTotals;
  prior: PeriodTotals;
}): LineTrend {
  const { recent, prior } = input;
  const enoughData = recent.operated >= MIN_TRIPS_PER_PERIOD && prior.operated >= MIN_TRIPS_PER_PERIOD;

  const recentOtpPercent = recent.operated > 0 ? round1((recent.onTime / recent.operated) * 100) : null;
  const priorOtpPercent = prior.operated > 0 ? round1((prior.onTime / prior.operated) * 100) : null;
  const deltaPoints =
    recentOtpPercent !== null && priorOtpPercent !== null ? round1(recentOtpPercent - priorOtpPercent) : null;

  const z = twoProportionZ(recent.onTime, recent.operated, prior.onTime, prior.operated);

  return {
    lineId: input.lineId,
    lineName: input.lineName,
    recentOtpPercent,
    priorOtpPercent,
    deltaPoints,
    recentTrips: recent.operated,
    priorTrips: prior.operated,
    direction: classifyTrend(deltaPoints ?? 0, z, enoughData),
    enoughData,
  };
}

export function summarizeTrends(trends: readonly LineTrend[], days: number): string {
  const worsening = trends.filter((t) => t.direction === "worsening");
  const improving = trends.filter((t) => t.direction === "improving");
  const comparable = trends.filter((t) => t.enoughData);

  if (comparable.length === 0) {
    return `Not enough data yet to compare the last ${days} days against the ${days} before.`;
  }
  if (worsening.length === 0 && improving.length === 0) {
    return `No line changed measurably over the last ${days} days compared with the ${days} before.`;
  }

  const parts: string[] = [];
  if (worsening.length > 0) {
    const worst = [...worsening].sort((a, b) => (a.deltaPoints ?? 0) - (b.deltaPoints ?? 0))[0] as LineTrend;
    parts.push(
      `${worsening.length === 1 ? "One line has" : `${worsening.length} lines have`} got measurably worse — ${worst.lineName} most of all, down ${Math.abs(worst.deltaPoints ?? 0)} points.`,
    );
  }
  if (improving.length > 0) {
    const best = [...improving].sort((a, b) => (b.deltaPoints ?? 0) - (a.deltaPoints ?? 0))[0] as LineTrend;
    parts.push(`${best.lineName} improved most, up ${best.deltaPoints} points.`);
  }
  return parts.join(" ");
}
