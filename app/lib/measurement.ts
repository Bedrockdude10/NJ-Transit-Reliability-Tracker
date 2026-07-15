/**
 * Emptiness detection + live-collection framing for INDEPENDENT (measured)
 * metrics. Pure functions — no React Native imports — so they're unit-tested by
 * Vitest and reused by every screen that renders measured data.
 *
 * The independent metrics come from the live GTFS-Realtime feed and are honestly
 * empty until data accrues. These helpers distinguish "no data yet" from a real
 * zero so screens can render an explicit empty state instead of a misleading 0%.
 * They never apply to the OFFICIAL NJT figures, which are real and populated.
 */

import type {
  ConnectionResponse,
  DistributionBucketResult,
  HeatmapBucketResult,
  OtpSummary,
  StationSummaryResponse,
} from "@njt/shared";
import { formatDay } from "./format";

/** True when the live feed has recorded at least one operated trip for the range. */
export function hasMeasuredOtp(summary: OtpSummary | null | undefined): boolean {
  return !!summary && summary.tripsOperated > 0;
}

/** True when a delay distribution has any observed trips (not just empty buckets). */
export function hasDistributionData(distribution: DistributionBucketResult[] | null | undefined): boolean {
  return !!distribution && distribution.some((b) => b.count > 0);
}

/** True when a heatmap has any observations behind its buckets. */
export function hasHeatmapData(buckets: HeatmapBucketResult[] | null | undefined): boolean {
  return !!buckets && buckets.some((b) => b.observations > 0);
}

/** True when a station summary has any measured observations across its views. */
export function hasStationData(summary: StationSummaryResponse | null | undefined): boolean {
  if (!summary) return false;
  return (
    summary.byLineDirection.some((r) => r.observations > 0) ||
    hasDistributionData(summary.delayDistribution) ||
    hasHeatmapData(summary.hourOfDay) ||
    summary.amplification.arrivedWithin5Min > 0
  );
}

/** True when a connection has any observed transfer attempts. */
export function hasConnectionData(conn: ConnectionResponse | null | undefined): boolean {
  return !!conn && conn.observations > 0;
}

export interface MeasurementStatus {
  /** Whether the live feed has started collecting (a collection-start date exists). */
  live: boolean;
  /** Short pill label: "LIVE" once collecting, "NO DATA YET" before. */
  badge: string;
  /** Full-sentence framing for banners/footers. */
  label: string;
}

/**
 * Honest live-collection framing derived from the health endpoint's
 * `collectionStartDate` (a `YYYY-MM-DD`, or null before any data accrues).
 * Never invents numbers: "Live · measuring since <date>" when collecting,
 * otherwise says measurement hasn't started yet.
 */
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
