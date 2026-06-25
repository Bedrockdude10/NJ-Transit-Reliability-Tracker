/**
 * Core domain entities. These mirror the Data Model section of the PRD.
 *
 * Conventions:
 * - Instants are stored as **epoch seconds (UTC)** unless the field name ends in
 *   `Ms`, in which case it is epoch milliseconds. SQLite stores these as INTEGER.
 * - `serviceDate` is the GTFS calendar date of the trip as `YYYY-MM-DD`, NOT a
 *   wall-clock timestamp. After-midnight trips keep the prior day's service date.
 * - `delaySeconds` is positive when late, negative when early.
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

/**
 * TripStopEvent — the core record. One row per (trip, stop, service date),
 * holding the authoritative observed/predicted delay at that stop.
 */
export interface TripStopEvent {
  tripId: string;
  routeId: string;
  lineName: string;
  stopId: string;
  stopName: string;
  stopSequence: number;
  direction: Direction;
  /** GTFS service date, `YYYY-MM-DD`. */
  serviceDate: string;
  /** Scheduled arrival, epoch seconds UTC (null if the stop has no arrival time). */
  scheduledArrival: number | null;
  scheduledDeparture: number | null;
  /** Predicted/observed arrival at the time of the final reading, epoch seconds UTC. */
  observedArrival: number | null;
  /** Positive = late, negative = early. Null when not yet observed. */
  delaySeconds: number | null;
  stopSkipped: boolean;
  tripCancelled: boolean;
  /** Which GTFS static snapshot the trip was matched against. */
  gtfsStaticVersion: string;
  /** When this reading was ingested, epoch milliseconds. */
  ingestedAtMs: number;
}

/** RawSnapshot — one row per successful GTFS-RT poll. Retained indefinitely. */
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
   * Cancellations broken down by NJT's cause categories (AMTRAK, Mechanical,
   * Crew/Engineer Availability, …) → count. Null when not imported. The AMTRAK
   * entry is the Amtrak-attributed share NJT excludes in its adjusted figures.
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
