/**
 * Core domain entities. Instants are epoch seconds (UTC) unless the field name
 * ends in `Ms`. `serviceDate` is the GTFS calendar date, `YYYY-MM-DD` — an
 * after-midnight trip keeps the prior day's service date.
 */

export type Direction = "inbound" | "outbound";

export type FeedType = "TripUpdates" | "VehiclePositions" | "ServiceAlerts";

/** GTFS-realtime Alert.Effect, normalized to a small closed set. */
export type EffectType =
  | "delay"
  | "cancellation"
  | "detour"
  | "reduced_service"
  | "additional_service"
  | "modified_service"
  | "no_service"
  | "stop_moved"
  | "other"
  | "unknown";

/** One row per (trip, stop, service date): the observed delay at that stop. */
export interface TripStopEvent {
  tripId: string;
  routeId: string;
  lineName: string;
  stopId: string;
  stopName: string;
  /**
   * @format int
   * @unit stop_index
   */
  stopSequence: number;
  direction: Direction;
  /** GTFS service date, `YYYY-MM-DD`. */
  serviceDate: string;
  /**
   * Scheduled arrival, epoch seconds UTC (null if the stop has no arrival time).
   * @format int
   * @unit epoch_seconds
   */
  scheduledArrival: number | null;
  /**
   * @format int
   * @unit epoch_seconds
   */
  scheduledDeparture: number | null;
  /**
   * Predicted/observed arrival at the time of the final reading, epoch seconds UTC.
   * @format int
   * @unit epoch_seconds
   */
  observedArrival: number | null;
  /**
   * Positive = late, negative = early. Null when not yet observed.
   * @format int
   * @unit seconds
   */
  delaySeconds: number | null;
  stopSkipped: boolean;
  tripCancelled: boolean;
  /** Which GTFS static snapshot the trip was matched against. */
  gtfsStaticVersion: string;
  /**
   * When this reading was ingested, epoch milliseconds.
   * @format int
   * @unit epoch_milliseconds
   */
  ingestedAtMs: number;
}

/**
 * Where a train is right now. Each poll returns a complete snapshot of active
 * vehicles, so the stored set is replaced wholesale rather than accumulated;
 * history stays recoverable from `raw_snapshots`.
 */
export interface VehiclePosition {
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  lineName: string | null;
  direction: Direction | null;
  latitude: number;
  longitude: number;
  /** Degrees clockwise from true north. */
  bearing: number | null;
  speedMetersPerSecond: number | null;
  /** GTFS `stop_id` this reading is relative to. */
  stopId: string | null;
  stopName: string | null;
  status: VehicleStopStatus | null;
  /** When the vehicle reported this position, epoch seconds UTC. */
  reportedAt: number | null;
  ingestedAtMs: number;
}

/** GTFS-realtime VehicleStopStatus. */
export type VehicleStopStatus = "incoming_at" | "stopped_at" | "in_transit_to";

/** One row per successful GTFS-RT poll. */
export interface RawSnapshot {
  id?: number;
  feedType: FeedType;
  fetchedAtMs: number;
  rawBytes: Uint8Array;
}

export interface ServiceAlert {
  alertId: string;
  affectedRoutes: string[];
  affectedStops: string[];
  headerText: string;
  descriptionText: string;
  effectType: EffectType;
  /** epoch seconds UTC, null if open-ended. */
  activeFrom: number | null;
  activeTo: number | null;
  ingestedAtMs: number;
}

export interface GtfsStaticVersion {
  versionId: string;
  /** epoch seconds UTC when this schedule became effective. */
  effectiveFrom: number;
  /** epoch seconds UTC when superseded, null while current. */
  effectiveTo: number | null;
  /** sha256 of the GTFS zip, used to detect changes. */
  checksum: string;
  ingestedAtMs: number;
}

export interface OfficialNjtMetric {
  /** 1-12 */
  month: number;
  year: number;
  lineName: string;
  /** NJT definition: within 6 minutes. */
  otpPercent: number;
  /** Amtrak-adjusted OTP for NEC / NJCL; null where not reported. */
  otpPercentAmtrakAdjusted: number | null;
  tripsOperated: number;
  cancellations: number;
  /**
   * NJT's cause category → count. Null when not imported. The AMTRAK entry is
   * the Amtrak-attributed share NJT excludes from its adjusted figures.
   */
  cancellationCauses: Record<string, number> | null;
}

/** NJT's systemwide fleet Mean Distance Between Failures (miles), monthly. */
export interface FleetMdbfMetric {
  month: number;
  year: number;
  /** Miles between failures. */
  mdbf: number;
}

/** Systemwide light rail on-time performance, monthly. */
export interface LightRailOtpMetric {
  year: number;
  month: number;
  otpPercent: number;
}

/** Per-line light rail Mean Distance Between Failures (miles), monthly. */
export interface LightRailMdbfMetric {
  year: number;
  month: number;
  lineName: string;
  mdbf: number;
}
