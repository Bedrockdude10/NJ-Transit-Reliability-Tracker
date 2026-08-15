/**
 * API response DTOs. These are the contract between the backend API and the
 * Expo frontend. The frontend imports these types directly; it never imports
 * the db or domain-storage types.
 */

import type { Direction, VehicleStopStatus } from "./domain";
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

/**
 * Which months an official (NJT-published, monthly) figure actually covers.
 *
 * NJT publishes performance data months in arrears, so the default "last 30
 * days" window routinely contains no published months at all. Rather than
 * render an empty panel, the API falls back to the most recent published month
 * and reports that here — the UI must label a fallback so the figure is never
 * mistaken for the requested period.
 */
export interface PublishedCoverage {
  /** `YYYY-MM`. */
  fromMonth: string;
  toMonth: string;
  /** True when these months fall outside the requested date range. */
  outsideRequestedRange: boolean;
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

/** One train's current position, for the live map. */
export interface MapVehicle {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  lineName: string | null;
  direction: Direction | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  /** Converted from the feed's metres/second for display. */
  speedMph: number | null;
  stopId: string | null;
  stopName: string | null;
  status: VehicleStopStatus | null;
  /** When the train reported this position, epoch seconds UTC. */
  reportedAt: number | null;
  /** Seconds between the reading and this response — staleness, made visible. */
  ageSeconds: number | null;
}

export interface MapVehiclesResponse {
  vehicles: MapVehicle[];
  /** When the newest reading in this set was ingested, epoch ms (null if empty). */
  lastIngestedAtMs: number | null;
  generatedAtMs: number;
}

// --- Departures --------------------------------------------------------------

/** How a departure is running, for at-a-glance colouring on the board. */
export type DepartureStatus = "on_time" | "late" | "early" | "cancelled" | "skipped" | "scheduled";

export interface Departure {
  tripId: string;
  lineId: string;
  lineName: string;
  direction: Direction;
  /** GTFS headsign — where the train is going. Null when the trip is unmatched. */
  destination: string | null;
  /** Timetabled departure (falls back to arrival), epoch seconds UTC. */
  scheduledTime: number | null;
  /** The feed's live prediction, epoch seconds UTC. Null when cancelled. */
  predictedTime: number | null;
  /** Positive = late. Null when the feed offers no prediction. */
  delaySeconds: number | null;
  /** Whole minutes until `predictedTime`; negative once it is due. */
  minutesAway: number | null;
  status: DepartureStatus;
}

export interface StationDeparturesResponse {
  stopId: string;
  stopName: string;
  departures: Departure[];
  /** Minutes ahead the board looks. */
  horizonMinutes: number;
  generatedAtMs: number;
}

// --- Trends --------------------------------------------------------------------

export type TrendDirection = "improving" | "worsening" | "stable";

export interface LineTrend {
  lineId: string;
  lineName: string;
  /** On-time rate over the recent period, null when nothing ran. */
  recentOtpPercent: number | null;
  /** The equal-length period immediately before it. */
  priorOtpPercent: number | null;
  /** Percentage points, recent minus prior. */
  deltaPoints: number | null;
  recentTrips: number;
  priorTrips: number;
  /**
   * "stable" also covers changes too small or too noisy to call — the app
   * never claims a trend it cannot distinguish from chance.
   */
  direction: TrendDirection;
  /** False when either period is too thin to compare at all. */
  enoughData: boolean;
}

export interface TrendsResponse {
  /** Length of each compared period, in days. */
  days: number;
  recentFrom: string;
  recentTo: string;
  priorFrom: string;
  priorTo: string;
  thresholdSeconds: number;
  lines: LineTrend[];
}

// --- Station rankings ----------------------------------------------------------

export type StationRankingSort = "delay" | "amplification";

export interface StationRanking {
  stopId: string;
  stopName: string;
  lines: string[];
  avgArrivalDelaySeconds: number;
  observations: number;
  /**
   * Share of trains that arrived on time but left late — delay the station
   * itself introduces, rather than delay it inherited from up the line.
   */
  amplificationRatePercent: number | null;
  arrivedWithin5Min: number;
  lowSample: boolean;
}

export interface StationRankingsResponse {
  from: string;
  to: string;
  sort: StationRankingSort;
  stations: StationRanking[];
  /** Stations excluded for having too few observations to rank fairly. */
  excludedLowSample: number;
}

// --- Delay propagation --------------------------------------------------------

/** Average delay at one stop along a line's route, in running order. */
export interface PropagationStop {
  stopId: string;
  stopName: string;
  /** Position along the route, 1-based. */
  sequence: number;
  avgDelaySeconds: number | null;
  observations: number;
  /**
   * Change in average delay since the previous stop. Positive = this segment
   * added delay; negative = trains recovered across it. Null at the first stop.
   */
  deltaSeconds: number | null;
}

/** A stop-to-stop segment ranked by how much delay it adds. */
export interface PropagationSegment {
  fromStopName: string;
  toStopName: string;
  addedSeconds: number;
}

export interface PropagationResponse {
  lineId: string;
  lineName: string;
  direction: Direction;
  from: string;
  to: string;
  stops: PropagationStop[];
  /** Segments that add the most delay, worst first. */
  worstSegments: PropagationSegment[];
  /** Segments where trains most reliably make time back. */
  bestRecoveries: PropagationSegment[];
  /** Delay at the last stop minus the first — the journey's net accumulation. */
  netAccumulatedSeconds: number | null;
}

// --- Commute -----------------------------------------------------------------

/** Reliability of one timetabled departure on a commute, over the period. */
export interface CommuteDeparture {
  /** Minutes after local midnight, so departures sort and label consistently. */
  departureMinutes: number;
  /** "7:42 AM". */
  label: string;
  lineName: string;
  /** Scheduled journey time in minutes; null if the timetable is incomplete. */
  scheduledMinutes: number | null;
  observations: number;
  cancellations: number;
  /** Share arriving within the strict threshold. Null below the sample floor. */
  onTimePercent: number | null;
  avgArrivalDelaySeconds: number | null;
  /** The delay you should plan around — exceeded one journey in ten. */
  p90ArrivalDelaySeconds: number | null;
  /** True when too few observations to draw a conclusion from. */
  lowSample: boolean;
}

export interface CommuteResponse {
  origin: { stopId: string; stopName: string };
  destination: { stopId: string; stopName: string };
  from: string;
  to: string;
  /** Lines that actually ran this pair in the period. */
  linesServing: string[];
  observations: number;
  cancellations: number;
  cancellationRatePercent: number;
  onTimePercent: number | null;
  avgArrivalDelaySeconds: number | null;
  p90ArrivalDelaySeconds: number | null;
  /** Median observed journey time, minutes. Null when nothing completed. */
  medianJourneyMinutes: number | null;
  /** Timetabled journey time, minutes. */
  scheduledJourneyMinutes: number | null;
  /** Every timetabled departure on this pair, earliest first. */
  departures: CommuteDeparture[];
  /** Most and least reliable departures with enough data to rank. */
  mostReliable: CommuteDeparture | null;
  leastReliable: CommuteDeparture | null;
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
  /** Months these figures cover; null if light rail data was never published. */
  coverage: PublishedCoverage | null;
}

// --- System -----------------------------------------------------------------

export interface SystemSummaryResponse {
  from: string;
  to: string;
  overall: OtpSummary;
  njtOfficial: NjtOfficialComparison | null;
  njtCancellations: NjtCancellations | null;
  fleetMdbf: FleetMdbf | null;
  /** Months `njtOfficial` / `njtCancellations` cover; null if never published. */
  officialCoverage: PublishedCoverage | null;
  /** Months `fleetMdbf` covers (published separately from per-line OTP). */
  fleetMdbfCoverage: PublishedCoverage | null;
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
  /** Months `njtOfficial` / `njtCancellations` cover; null if never published. */
  officialCoverage: PublishedCoverage | null;
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

/**
 * One predicted leg, as the app shows it.
 *
 * Station *names* rather than the ids the model works in: the modelling repo
 * deals in GTFS ids and the app renders places people recognise, and resolving
 * that here keeps a screen from having to join two payloads.
 */
export interface PredictedDelay {
  tripId: string;
  lineName: string;
  fromStopName: string;
  toStopName: string;
  /** How far ahead the prediction reaches, in seconds. */
  horizonSeconds: number;
  /** Predicted delay at the destination, seconds; positive = late. */
  predictedDelaySeconds: number;
  /** Observed delay once the trip has run, or null while it is still ahead. */
  actualDelaySeconds: number | null;
  /** Signed error once both are known: positive = the model was optimistic. */
  errorSeconds: number | null;
}

/**
 * What produced a set of predictions.
 *
 * Shown with the numbers rather than alongside them optionally. A forecast with
 * no provenance invites more confidence than it has earned, and this is the
 * difference between "a model said this" and "the data says this".
 */
export interface PredictionProvenance {
  modelVersion: string;
  runId: string;
  /** When the most recent prediction was made, epoch seconds UTC. */
  predictedAtEpochSeconds: number;
}

/**
 * `GET /predictions?date=` — model output for one service date.
 *
 * `available: false` is the normal state until the modelling repo has run, not
 * an error: this project publishes no synthetic data, so an unpredicted day says
 * so rather than showing a plausible number.
 */
export interface PredictionsResponse {
  serviceDate: string;
  available: boolean;
  /** Service dates that do hold predictions, so a screen can offer them. */
  availableDates: string[];
  /** Lines with predictions on this date, for filtering. */
  lines: string[];
  provenance: PredictionProvenance | null;
  /**
   * The most delayed legs, largest first — not everything.
   *
   * A service date holds ~50,000 legs, which is ~5 MB of JSON and 300 KB of DOM,
   * and most of them are a shuttle predicted to be on time. The rider's question
   * is about the trains in trouble, so the response carries those and
   * `totalPredictions` says how many there were.
   */
  predictions: PredictedDelay[];
  /** How many legs were predicted for this date, before the cap. */
  totalPredictions: number;
  /**
   * Mean absolute error over the legs whose actual is known, or null when none
   * are. The honest headline: how wrong the model has been, not how confident.
   */
  meanAbsoluteErrorSeconds: number | null;
  /** How many legs have an actual to compare against. */
  scoredCount: number;
}
