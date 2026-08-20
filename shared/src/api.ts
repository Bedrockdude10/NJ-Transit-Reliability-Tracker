import type { Direction, VehicleStopStatus } from "./domain";
import type { CertificateBand, HeatmapType } from "./constants";

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
 * NJT publishes performance data months in arrears, so a "last 30 days" window
 * routinely covers no published month; the API falls back to the most recent
 * published one and reports it here so the UI can label the fallback.
 */
export interface PublishedCoverage {
  /** `YYYY-MM`. */
  fromMonth: string;
  toMonth: string;
  outsideRequestedRange: boolean;
}

export interface NjtOfficialComparison {
  thresholdSeconds: number;
  otpPercent: number;
  otpPercentAmtrakAdjusted: number | null;
  monthsCovered: number;
  tripsOperated: number;
  cancellations: number;
  cancellationRatePercent: number;
}

export interface CancellationCauseResult {
  cause: string;
  count: number;
  percent: number;
}

export interface NjtCancellations {
  total: number;
  byCause: CancellationCauseResult[];
  monthsCovered: number;
}

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

export interface MapStation {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
}

export interface MapLine {
  lineId: string;
  name: string;
  shortName: string;
  mode: "rail" | "light_rail";
  /** Official NJT route color (hex, no leading #). */
  color: string;
  njtOtpPercent: number | null;
  /** Independent (measured) OTP at the 15-min threshold. */
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

export interface MapVehicle {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  lineName: string | null;
  direction: Direction | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speedMph: number | null;
  stopId: string | null;
  stopName: string | null;
  status: VehicleStopStatus | null;
  /** When the train reported this position, epoch seconds UTC. */
  reportedAt: number | null;
  ageSeconds: number | null;
}

export interface MapVehiclesResponse {
  vehicles: MapVehicle[];
  lastIngestedAtMs: number | null;
  generatedAtMs: number;
}

export type DepartureStatus = "on_time" | "late" | "early" | "cancelled" | "skipped" | "scheduled";

export interface Departure {
  tripId: string;
  lineId: string;
  lineName: string;
  direction: Direction;
  /** GTFS headsign; null when the trip is unmatched. */
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
  horizonMinutes: number;
  generatedAtMs: number;
}

export type TrendDirection = "improving" | "worsening" | "stable";

export interface LineTrend {
  lineId: string;
  lineName: string;
  recentOtpPercent: number | null;
  /** The equal-length period immediately before it. */
  priorOtpPercent: number | null;
  /** Percentage points, recent minus prior. */
  deltaPoints: number | null;
  recentTrips: number;
  priorTrips: number;
  /** "stable" also covers changes too small or too noisy to call. */
  direction: TrendDirection;
  enoughData: boolean;
}

export interface TrendsResponse {
  days: number;
  recentFrom: string;
  recentTo: string;
  priorFrom: string;
  priorTo: string;
  thresholdSeconds: number;
  lines: LineTrend[];
}

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
  excludedLowSample: number;
}

/** Average delay at one stop along a line's route, in running order. */
export interface PropagationStop {
  stopId: string;
  stopName: string;
  /** Position along the route, 1-based. */
  sequence: number;
  avgDelaySeconds: number | null;
  observations: number;
  /**
   * Change in average delay since the previous stop; positive = this segment
   * added delay. Null at the first stop.
   */
  deltaSeconds: number | null;
}

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
  /** Delay at the last stop minus the first. */
  netAccumulatedSeconds: number | null;
}

export interface CommuteDeparture {
  /** Minutes after local midnight. */
  departureMinutes: number;
  /** "7:42 AM". */
  label: string;
  lineName: string;
  scheduledMinutes: number | null;
  observations: number;
  cancellations: number;
  /** Share arriving within the strict threshold. Null below the sample floor. */
  onTimePercent: number | null;
  avgArrivalDelaySeconds: number | null;
  p90ArrivalDelaySeconds: number | null;
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
  /** Median observed journey time, minutes. */
  medianJourneyMinutes: number | null;
  /** Timetabled journey time, minutes. */
  scheduledJourneyMinutes: number | null;
  /** Every timetabled departure on this pair, earliest first. */
  departures: CommuteDeparture[];
  mostReliable: CommuteDeparture | null;
  leastReliable: CommuteDeparture | null;
}

export interface LightRailLineMdbf {
  lineName: string;
  avgMdbf: number;
  monthsCovered: number;
}

export interface LightRailSummaryResponse {
  from: string;
  to: string;
  /** Average systemwide light-rail OTP over the period. */
  otpPercent: number | null;
  monthsCovered: number;
  lines: LightRailLineMdbf[];
  /** Monthly systemwide light-rail OTP over the period, ascending. */
  otpTrend: { month: string; otpPercent: number }[];
  coverage: PublishedCoverage | null;
}

export interface SystemSummaryResponse {
  from: string;
  to: string;
  overall: OtpSummary;
  njtOfficial: NjtOfficialComparison | null;
  njtCancellations: NjtCancellations | null;
  fleetMdbf: FleetMdbf | null;
  /** Months `njtOfficial` / `njtCancellations` cover. */
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

export interface LineListItem {
  /** Public identifier used in API paths and deep links (the GTFS route_id). */
  id: string;
  slug: string;
  name: string;
  shortName: string;
  hasAmtrakAttribution: boolean;
  /** Official NJT route color (hex, no leading #). */
  color: string | null;
  /** NJT's reported OTP for the most recent published month. */
  njtOtpPercent: number | null;
  njtCancellationRatePercent: number | null;
  /** The month those NJT figures are from, `YYYY-MM`. */
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
  /** Months `njtOfficial` / `njtCancellations` cover. */
  officialCoverage: PublishedCoverage | null;
}

export interface TrendPoint {
  date: string;
  otpPercent15Min: number;
  cancellationRatePercent: number;
  tripsOperated: number;
  /** NJT's reported 6-min OTP for the month this point falls in. */
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
  /** NJT's reported 6-minute OTP for the month. */
  njtOtpPercent: number | null;
  njtOtpPercentAmtrakAdjusted: number | null;
  /** This project's OTP at the 15-minute threshold. */
  projectOtpPercent15Min: number | null;
  projectTripsOperated: number;
}

export interface LineMonthlyResponse {
  lineId: string;
  name: string;
  rows: MonthlyComparisonRow[];
}

/** Average NJT OTP for a calendar month across all available years. */
export interface SeasonalityMonth {
  /** 1-12. */
  month: number;
  avgOtpPercent: number | null;
  years: number;
}

export interface AnnualOtpYear {
  year: number;
  avgOtpPercent: number | null;
  months: number;
}

export interface HistoryResponse {
  scopeLabel: string;
  seasonality: SeasonalityMonth[];
  annual: AnnualOtpYear[];
  /** Fleet mean-distance-between-failures by year (system scope only). */
  mdbfAnnual?: { year: number; avgMdbf: number }[] | undefined;
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
 * The range a model puts a delay in. Null where the run produced only a point
 * estimate, which is most days until the modelling repo publishes intervals.
 */
export interface PredictionInterval {
  /** Lower bound, seconds; positive = late. */
  lowerSeconds: number;
  /** Upper bound, seconds. */
  upperSeconds: number;
  /** Coverage: 80 means 8 runs in 10 are expected to land inside the range. */
  percent: number;
}

export interface PredictedDelay {
  tripId: string;
  lineName: string;
  fromStopName: string;
  toStopName: string;
  /** How far ahead the prediction reaches, in seconds. */
  horizonSeconds: number;
  /**
   * Scheduled arrival at `toStopName` as GTFS "HH:MM:SS", the key the list is
   * ordered by. Hours pass 24 for a trip running into the next day. Null when the
   * timetable holds no entry for this leg.
   */
  scheduledArrivalTime: string | null;
  /** Predicted delay at the destination, seconds; positive = late. */
  predictedDelaySeconds: number;
  interval: PredictionInterval | null;
  /** Observed delay once the trip has run, or null while it is still ahead. */
  actualDelaySeconds: number | null;
  /** Signed error once both are known: positive = the model was optimistic. */
  errorSeconds: number | null;
}

/** One horizon's accuracy for a model version, summed over the dates it scored. */
export interface ModelHorizonAccuracy {
  /** How far ahead the prediction reached, in seconds. */
  horizonSeconds: number;
  predictions: number;
  maeSeconds: number;
  /** Signed: positive means the train was later than the model said. */
  biasSeconds: number;
  /** Share of predictions that were optimistic, 0-100. */
  falselyReassuringPercent: number;
}

/** A model version's track record, from the scorecards it published. */
export interface ModelAccuracy {
  modelVersion: string;
  /** MLflow run ids behind these numbers, so any one can be traced back. */
  runIds: string[];
  serviceDates: string[];
  predictions: number;
  /** Weighted by how many legs each horizon scored, never a mean of means. */
  maeSeconds: number;
  biasSeconds: number;
  horizons: ModelHorizonAccuracy[];
}

export interface ModelAccuracyResponse {
  /** Null when every scored date is included rather than one. */
  serviceDate: string | null;
  available: boolean;
  /** Service dates that do hold scorecards, so a screen can offer them. */
  availableDates: string[];
  models: ModelAccuracy[];
}

export interface PredictionProvenance {
  modelVersion: string;
  runId: string;
  /** When the most recent prediction was made, epoch seconds UTC. */
  predictedAtEpochSeconds: number;
}

/**
 * `GET /predictions?date=` — model output for one service date. `available:
 * false` is the normal state until the modelling repo has run, not an error.
 */
export interface PredictionsResponse {
  serviceDate: string;
  available: boolean;
  /** Service dates that do hold predictions, so a screen can offer them. */
  availableDates: string[];
  lines: string[];
  provenance: PredictionProvenance | null;
  /**
   * Every leg held for the service date, ordered by scheduled arrival — the order
   * a rider meets them, so theirs can be found. Pass `limit` to take a prefix.
   */
  predictions: PredictedDelay[];
  totalPredictions: number;
  /** Mean absolute error over the legs whose actual is known. */
  meanAbsoluteErrorSeconds: number | null;
  /** How many legs have an actual to compare against. */
  scoredCount: number;
}

export interface TrainRunResult {
  serviceDate: string;
  /** Null when the trip was cancelled, or the stop was never reached. */
  delaySeconds: number | null;
  cancelled: boolean;
}

export interface TrainRecordThreshold {
  thresholdSeconds: number;
  onTimePercent: number;
}

/**
 * `GET /trips/:tripId/record` — one departure's own punctuality history, after
 * Deutsche Bahn's per-train record. See README "Train record".
 */
export interface TrainRecordResponse {
  tripId: string;
  lineName: string;
  direction: Direction;
  originStopName: string;
  terminalStopName: string;
  /** Where lateness was measured; the terminal unless a stop was asked for. */
  measuredAtStopId: string;
  measuredAtStopName: string;
  from: string;
  to: string;
  /** Service dates the departure ran, cancellations included. */
  runs: number;
  cancellations: number;
  /** Share of completed runs more than the strict threshold late. */
  latePercent: number;
  onTime: TrainRecordThreshold[];
  medianDelaySeconds: number | null;
  p90DelaySeconds: number | null;
  /** Newest last, so a strip of runs reads left to right. */
  recentRuns: TrainRunResult[];
  lowSample: boolean;
}

export interface CertificateBandResult {
  band: CertificateBand;
  label: string;
  startHour: number;
  /** Exclusive; 24 means midnight. */
  endHour: number;
  trainsObserved: number;
  trainsLate: number;
  latePercent: number;
  avgDelaySeconds: number;
  maxDelaySeconds: number;
  /** True when this band's average delay reaches the certificate threshold. */
  issued: boolean;
  lowSample: boolean;
}

/**
 * `GET /certificates?line=&date=` — the delay certificate, after JR East's
 * 遅延証明書. See README "Delay certificate".
 */
export interface CertificateResponse {
  lineName: string;
  serviceDate: string;
  thresholdSeconds: number;
  /** Every band of the day, in order, whether or not it qualifies. */
  bands: CertificateBandResult[];
  /** True when any band qualifies, so a screen can say there is nothing to certify. */
  issued: boolean;
  worstBand: CertificateBand | null;
  /** Service dates with arrivals, so a screen can offer them. */
  availableDates: string[];
  lines: string[];
}
