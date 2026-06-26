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
  /** Real, NJT-reported operations totals over the covered months. */
  tripsOperated: number;
  cancellations: number;
  cancellationRatePercent: number;
}

export interface CancellationCauseResult {
  cause: string;
  count: number;
  percent: number;
}

/** NJT's reported cancellations for the period, broken down by cause. */
export interface NjtCancellations {
  total: number;
  byCause: CancellationCauseResult[];
  monthsCovered: number;
}

/** Systemwide fleet reliability for the period. */
export interface FleetMdbf {
  avgMiles: number;
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

/** Completeness of NJT's published monthly data for a line (detects gaps). */
export interface OfficialCoverage {
  lineName: string;
  firstMonth: string | null;
  lastMonth: string | null;
  monthsPresent: number;
  monthsExpected: number;
  missingMonths: string[];
}

export interface HealthResponse {
  collectionStartDate: string | null;
  uptimePercent: number;
  feeds: FeedHealth[];
  knownGaps: DataGap[];
  officialCoverage: OfficialCoverage[];
  generatedAtMs: number;
}

// --- Map ---------------------------------------------------------------------

export interface MapStation {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
}

export interface MapLine {
  /** Catalog route id, for deep-linking to Line Detail. */
  lineId: string;
  name: string;
  shortName: string;
  mode: "rail" | "light_rail";
  /** Official NJT route color (hex, no leading #). */
  color: string;
  /** Real NJT OTP for the period (drives reliability coloring), null if none. */
  njtOtpPercent: number | null;
  /** Independent (measured) OTP at the 15-min threshold, null if none. */
  projectOtpPercent15Min: number | null;
  /** Ordered stop ids tracing the line's path (keys into `stations`). */
  path: string[];
}

export interface MapResponse {
  from: string;
  to: string;
  stations: MapStation[];
  lines: MapLine[];
}

// --- Light rail --------------------------------------------------------------

export interface LightRailLineMdbf {
  lineName: string;
  avgMdbf: number;
  monthsCovered: number;
}

export interface LightRailSummaryResponse {
  from: string;
  to: string;
  /** Average systemwide light-rail OTP over the period (null if none). */
  otpPercent: number | null;
  monthsCovered: number;
  lines: LightRailLineMdbf[];
  /** Monthly systemwide light-rail OTP over the period, ascending. */
  otpTrend: { month: string; otpPercent: number }[];
}

// --- System -----------------------------------------------------------------

export interface SystemSummaryResponse {
  from: string;
  to: string;
  overall: OtpSummary;
  njtOfficial: NjtOfficialComparison | null;
  njtCancellations: NjtCancellations | null;
  fleetMdbf: FleetMdbf | null;
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
  /** Official NJT route color (hex, no leading #), null if unknown. */
  color: string | null;
  /** NJT's reported OTP for the most recent published month (null if none). */
  njtOtpPercent: number | null;
  njtCancellationRatePercent: number | null;
  /** The month those NJT figures are from, `YYYY-MM` (null if none). */
  njtLatestMonth: string | null;
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
  njtCancellations: NjtCancellations | null;
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

export interface MonthlyComparisonRow {
  /** `YYYY-MM`. */
  month: string;
  /** NJT's reported 6-minute OTP for the month, null if not published. */
  njtOtpPercent: number | null;
  njtOtpPercentAmtrakAdjusted: number | null;
  /** This project's OTP at the 15-minute threshold, null if no data that month. */
  projectOtpPercent15Min: number | null;
  projectTripsOperated: number;
}

export interface LineMonthlyResponse {
  lineId: string;
  name: string;
  rows: MonthlyComparisonRow[];
}

/** Average NJT OTP for a calendar month (1-12) across all available years. */
export interface SeasonalityMonth {
  month: number;
  avgOtpPercent: number | null;
  years: number;
}

/** Average NJT OTP for a calendar year. */
export interface AnnualOtpYear {
  year: number;
  avgOtpPercent: number | null;
  months: number;
}

/** Long-run NJT history for a scope: seasonality (by month) + annual trend. */
export interface HistoryResponse {
  scopeLabel: string;
  seasonality: SeasonalityMonth[];
  annual: AnnualOtpYear[];
  /** Fleet mean-distance-between-failures by year (system scope only). */
  mdbfAnnual?: { year: number; avgMdbf: number }[];
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
