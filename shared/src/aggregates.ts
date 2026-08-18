/**
 * Pre-computed aggregate rows. Daily is the atomic unit — there are no stored
 * rolling-window rows; the API sums daily rows over any requested range.
 */

import type { Direction } from "./domain";
import type { HeatmapType, ScopeKind } from "./constants";

export type DirectionFilter = Direction | "all";

/**
 * Daily OTP rollup for a scope and direction. Counts are by terminal delay: one
 * observation per operated trip. Percentiles are estimated from the matching
 * {@link DelayDistributionDailyRow}.
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
  sumDelaySeconds: number;
}

export interface DelayDistributionDailyRow {
  scope: ScopeKind;
  scopeId: string;
  serviceDate: string;
  /** `{ bucketLabel: count }`. */
  counts: Record<string, number>;
}

/** Average delay for one time bucket of a scope. */
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

export interface StationHourlyRow {
  stopId: string;
  serviceDate: string;
  hour: number;
  sumDelaySeconds: number;
  observations: number;
}

export interface StationDistributionDailyRow {
  stopId: string;
  serviceDate: string;
  counts: Record<string, number>;
}

/**
 * Daily connection reliability for one (inbound trip, transfer stop, outbound
 * trip) triple. "Success" = the inbound arrives early enough to board the
 * scheduled outbound.
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
