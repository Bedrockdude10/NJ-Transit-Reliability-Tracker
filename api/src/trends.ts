import type { OtpDailyRow } from "@njt/shared";
import type { LineTrend, TrendDirection } from "@njt/shared";
import { round1 } from "./util";

/**
 * A two-proportion z-test, not a fixed point threshold, so the same delta is
 * called on a busy line and withheld on a quiet one. Trains on one day share
 * weather and crew, so trials aren't independent and this over-flags: a screen,
 * not proof.
 */

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
  // A pooled rate at either extreme leaves no variance to divide by.
  const variance = pooled * (1 - pooled) * (1 / totalA + 1 / totalB);
  if (variance <= 0) return null;
  return (pA - pB) / Math.sqrt(variance);
}

/** |z| beyond this is conventionally "unlikely to be chance" at p < 0.05. */
export const SIGNIFICANCE_Z = 1.96;

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
