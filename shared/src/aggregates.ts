/**
 * Pre-computed aggregate rows. The pipeline recomputes these from raw events on
 * a schedule; the API sums them over a requested date range. **Daily is the
 * atomic unit** — there are no stored rolling-window rows. Rolling windows (7d/
 * 30d/90d) and arbitrary custom ranges are produced by the API cheaply summing
 * daily rows, so the API never aggregates the raw event table at request time
 * yet any date range can still be queried (PRD success criterion #7).
 *
 * `Record<string, number>` maps are stored as JSON TEXT columns by the db layer.
 */

import type { Direction } from "./domain";
import type { HeatmapType, ScopeKind } from "./constants";

export type DirectionFilter = Direction | "all";

/**
 * Daily OTP rollup for a scope (system or a line) and direction. Counts are by
 * terminal delay: one observation per operated trip. `sumDelaySeconds` lets the
 * API compute a weighted mean across any range; percentiles are estimated from
 * the matching {@link DelayDistributionDailyRow}.
 */
export interface OtpDailyRow {
  scope: ScopeKind;
  /** `system` or a line's routeId. */
  scopeId: string;
  serviceDate: string;
  direction: DirectionFilter;
  tripsOperated: number;
  tripsCancelled: number;
  /** `{ thresholdSeconds: onTimeCount }` — on-time-or-better trips per threshold. */
  onTimeCounts: Record<string, number>;
  /** Sum of terminal delays over operated trips (for range-weighted mean). */
  sumDelaySeconds: number;
}

/** Daily delay distribution histogram for a scope. */
export interface DelayDistributionDailyRow {
  scope: ScopeKind;
  scopeId: string;
  serviceDate: string;
  /** `{ bucketLabel: count }`. */
  counts: Record<string, number>;
}

/** Daily heatmap cell: average delay for one time bucket of a scope. */
export interface HeatmapDailyRow {
  scope: ScopeKind;
  scopeId: string;
  type: HeatmapType;
  /** 0-23 for hour_of_day, 0-6 (Sun-Sat) for day_of_week. */
  bucket: number;
  serviceDate: string;
  sumDelaySeconds: number;
  observations: number;
}

/** Per-trip daily terminal-delay rollup, basis for "most delayed trips". */
export interface TripDailyRow {
  tripId: string;
  routeId: string;
  lineName: string;
  direction: Direction;
  serviceDate: string;
  terminalStopName: string;
  /** Terminal (final-stop) delay in seconds; null when the trip didn't run. */
  terminalDelaySeconds: number | null;
}

/** Per-station daily rollup, split by line and direction. */
export interface StationDailyRow {
  stopId: string;
  serviceDate: string;
  lineName: string;
  direction: Direction;
  sumArrivalDelaySeconds: number;
  observations: number;
  /** Trains that arrived within 5 minutes of schedule (basis for amplification). */
  arrivedWithin5Min: number;
  /** Of those near-on-time arrivals, how many then departed more than 5 min late. */
  departedLateAfterOnTimeArrival: number;
}

/** Per-station hourly delay rollup (for the station hour-of-day pattern). */
export interface StationHourlyRow {
  stopId: string;
  serviceDate: string;
  hour: number;
  sumDelaySeconds: number;
  observations: number;
}

/** Per-station daily delay distribution. */
export interface StationDistributionDailyRow {
  stopId: string;
  serviceDate: string;
  counts: Record<string, number>;
}

/**
 * Daily connection reliability for one (inbound trip, transfer stop, outbound
 * trip) triple. "Success" = the inbound train arrives early enough for a rider
 * to board the scheduled outbound.
 */
export interface ConnectionDailyRow {
  inboundTripId: string;
  transferStopId: string;
  outboundTripId: string;
  serviceDate: string;
  observations: number;
  successes: number;
  peakObservations: number;
  peakSuccesses: number;
  offPeakObservations: number;
  offPeakSuccesses: number;
  /** `{ dayOfWeek(0-6): { observations, successes } }`. */
  byDayOfWeek: Record<string, { observations: number; successes: number }>;
  /** Distribution of inbound delay at the transfer stop: `{ bucketLabel: count }`. */
  inboundDelayDistribution: Record<string, number>;
}
