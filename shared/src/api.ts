/**
 * API response DTOs. These are the contract between the backend API and the
 * Expo frontend. The frontend imports these types directly; it never imports
 * the db or domain-storage types.
 */

import type { Direction } from "./domain";
import type { HeatmapType } from "./constants";

export interface DistributionBucketResult {
  label: string;
  count: number;
}

export interface OtpThresholdResult {
  thresholdSeconds: number;
  thresholdMinutes: number;
  otpPercent: number;
  onTimeTrips: number;
}

/** Shared OTP block used by system, line, and direction summaries. */
export interface OtpSummary {
  tripsOperated: number;
  tripsCancelled: number;
  cancellationRatePercent: number;
  avgDelaySeconds: number;
  medianDelaySeconds: number;
  p90DelaySeconds: number;
  thresholds: OtpThresholdResult[];
  delayDistribution: DistributionBucketResult[];
}

/** NJT's own reported figure for the period, for side-by-side comparison. */
export interface NjtOfficialComparison {
  thresholdSeconds: number;
  otpPercent: number;
  otpPercentAmtrakAdjusted: number | null;
  monthsCovered: number;
}

export interface HeatmapBucketResult {
  bucket: number;
  label: string;
  avgDelaySeconds: number;
  observations: number;
}

// --- Health -----------------------------------------------------------------

export interface FeedHealth {
  feedType: string;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  pollsToday: number;
  failuresToday: number;
}

export interface DataGap {
  feedType: string;
  startMs: number;
  endMs: number;
}

export interface HealthResponse {
  collectionStartDate: string | null;
  uptimePercent: number;
  feeds: FeedHealth[];
  knownGaps: DataGap[];
  generatedAtMs: number;
}

// --- System -----------------------------------------------------------------

export interface SystemSummaryResponse {
  from: string;
  to: string;
  overall: OtpSummary;
  njtOfficial: NjtOfficialComparison | null;
}

export interface HeatmapResponse {
  from: string;
  to: string;
  type: HeatmapType;
  buckets: HeatmapBucketResult[];
}

// --- Lines ------------------------------------------------------------------

export interface LineListItem {
  /** Public identifier used in API paths and deep links (the GTFS route_id). */
  id: string;
  slug: string;
  name: string;
  shortName: string;
  hasAmtrakAttribution: boolean;
}

export interface LineListResponse {
  lines: LineListItem[];
}

export interface LineSummaryResponse {
  lineId: string;
  name: string;
  from: string;
  to: string;
  overall: OtpSummary;
  inbound: OtpSummary;
  outbound: OtpSummary;
  njtOfficial: NjtOfficialComparison | null;
}

export interface TrendPoint {
  date: string;
  otpPercent15Min: number;
  cancellationRatePercent: number;
  tripsOperated: number;
  /** NJT's reported 6-min OTP for the month this point falls in, if available. */
  njtOfficialOtpPercent: number | null;
}

export interface LineTrendResponse {
  lineId: string;
  from: string;
  to: string;
  interval: "daily" | "weekly";
  njtThresholdSeconds: number;
  points: TrendPoint[];
}

export interface WorstTrip {
  tripId: string;
  routeId: string;
  lineName: string;
  direction: Direction;
  terminalStopName: string;
  avgTerminalDelaySeconds: number;
  observations: number;
}

export interface WorstTripsResponse {
  scopeLabel: string;
  from: string;
  to: string;
  trips: WorstTrip[];
}

// --- Stations ---------------------------------------------------------------

export interface StationListItem {
  stopId: string;
  stopName: string;
  lines: string[];
}

export interface StationListResponse {
  stations: StationListItem[];
}

export interface StationLineDirectionDelay {
  lineName: string;
  direction: Direction;
  avgArrivalDelaySeconds: number;
  observations: number;
}

export interface StationSummaryResponse {
  stopId: string;
  stopName: string;
  from: string;
  to: string;
  byLineDirection: StationLineDirectionDelay[];
  delayDistribution: DistributionBucketResult[];
  hourOfDay: HeatmapBucketResult[];
  amplification: {
    arrivedWithin5Min: number;
    departedLate: number;
    amplificationRatePercent: number;
  };
}

// --- Connections ------------------------------------------------------------

export interface ConnectionDayOfWeekResult {
  dayOfWeek: number;
  observations: number;
  successes: number;
  successRatePercent: number;
}

export interface ConnectionRateResult {
  observations: number;
  successes: number;
  successRatePercent: number;
}

export interface ConnectionResponse {
  inboundTripId: string;
  transferStopId: string;
  outboundTripId: string;
  from: string;
  to: string;
  observations: number;
  successes: number;
  successRatePercent: number;
  byDayOfWeek: ConnectionDayOfWeekResult[];
  peak: ConnectionRateResult;
  offPeak: ConnectionRateResult;
  inboundDelayDistribution: DistributionBucketResult[];
  lowSample: boolean;
  summaryText: string;
}

export interface ConnectionTopItem {
  inboundTripId: string;
  transferStopId: string;
  transferStopName: string;
  outboundTripId: string;
  observations: number;
}

export interface ConnectionTopResponse {
  transfers: ConnectionTopItem[];
}

// --- Alerts -----------------------------------------------------------------

export interface AlertListItem {
  alertId: string;
  affectedRoutes: string[];
  affectedStops: string[];
  headerText: string;
  descriptionText: string;
  effectType: string;
  activeFrom: number | null;
  activeTo: number | null;
  ingestedAtMs: number;
}

export interface AlertListResponse {
  alerts: AlertListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AlertFrequencyLine {
  lineName: string;
  counts: Record<string, number>;
  total: number;
}

export interface AlertFrequencyResponse {
  from: string;
  to: string;
  byLine: AlertFrequencyLine[];
}
