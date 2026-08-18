/**
 * Distinguishes "no data yet" from a real zero, so a screen renders an empty
 * state rather than a misleading 0%. Applies to the measured metrics only —
 * never to the official NJT figures, which are always populated.
 */

import type {
  ConnectionResponse,
  DistributionBucketResult,
  HeatmapBucketResult,
  OtpSummary,
  StationSummaryResponse,
} from "@njt/shared";
import { formatDay } from "./format";

export function hasMeasuredOtp(summary: OtpSummary | null | undefined): boolean {
  return !!summary && summary.tripsOperated > 0;
}

/** Observed trips, not merely non-empty buckets. */
export function hasDistributionData(distribution: DistributionBucketResult[] | null | undefined): boolean {
  return !!distribution && distribution.some((b) => b.count > 0);
}

export function hasHeatmapData(buckets: HeatmapBucketResult[] | null | undefined): boolean {
  return !!buckets && buckets.some((b) => b.observations > 0);
}

export function hasStationData(summary: StationSummaryResponse | null | undefined): boolean {
  if (!summary) return false;
  return (
    summary.byLineDirection.some((r) => r.observations > 0) ||
    hasDistributionData(summary.delayDistribution) ||
    hasHeatmapData(summary.hourOfDay) ||
    summary.amplification.arrivedWithin5Min > 0
  );
}

export function hasConnectionData(conn: ConnectionResponse | null | undefined): boolean {
  return !!conn && conn.observations > 0;
}

export interface MeasurementStatus {
  live: boolean;
  badge: string;
  label: string;
}

/** `collectionStartDate` is `YYYY-MM-DD`, or null before any data accrues. */
export function measurementStatus(collectionStartDate: string | null | undefined): MeasurementStatus {
  if (!collectionStartDate) {
    return {
      live: false,
      badge: "NO DATA YET",
      label: "Measurement hasn’t started yet — the live GTFS-Realtime feed isn’t collecting data.",
    };
  }
  return {
    live: true,
    badge: "LIVE",
    label: `Live · measuring since ${formatDay(collectionStartDate)}`,
  };
}
