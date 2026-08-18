import type { FeedType } from "./domain";

/** IANA timezone for all NJT service. */
export const NJT_TIMEZONE = "America/New_York";

/** Thresholds (seconds) at which OTP is computed, all stricter than NJT's. */
export const OTP_THRESHOLDS_SECONDS = [300, 600, 900, 1800, 3600] as const;
export type OtpThresholdSeconds = (typeof OTP_THRESHOLDS_SECONDS)[number];

/** NJT's published threshold: "on time" means within 6 minutes. */
export const NJT_OFFICIAL_THRESHOLD_SECONDS = 360;

/**
 * The headline threshold, and the arrival window for the amplification test.
 * SSOT for the pipeline's `ON_TIME_SECS` and the default late threshold.
 */
export const OTP_STRICT_THRESHOLD_SECONDS = 300;

/**
 * At or above `good` renders green, at or above `fair` amber, below red. SSOT
 * for `otpColor*` in the app.
 */
export const OTP_GOOD_THRESHOLD_PERCENT = 90;
export const OTP_FAIR_THRESHOLD_PERCENT = 75;

export const DIRECTIONS = ["inbound", "outbound"] as const;

export const WINDOW_KINDS = [
  "daily",
  "rolling_7d",
  "rolling_30d",
  "rolling_90d",
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export const WINDOW_DAYS: Record<WindowKind, number> = {
  daily: 1,
  rolling_7d: 7,
  rolling_30d: 30,
  rolling_90d: 90,
};

export const SCOPE_KINDS = ["system", "line"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
/** Scope id for the system-wide rollup. */
export const SYSTEM_SCOPE_ID = "system";

export const HEATMAP_TYPES = ["hour_of_day", "day_of_week"] as const;
export type HeatmapType = (typeof HEATMAP_TYPES)[number];

/**
 * Ranges are [minSeconds, maxSeconds), in seconds; `maxSeconds: null` is
 * open-ended.
 */
export interface DelayBucket {
  label: string;
  /** Compact label for dense axes/legends. */
  shortLabel: string;
  minSeconds: number;
  maxSeconds: number | null;
}

export const DELAY_BUCKETS: readonly DelayBucket[] = [
  { label: "early", shortLabel: "early", minSeconds: Number.NEGATIVE_INFINITY, maxSeconds: 0 },
  { label: "0-5 min", shortLabel: "0–5", minSeconds: 0, maxSeconds: 300 },
  { label: "5-10 min", shortLabel: "5–10", minSeconds: 300, maxSeconds: 600 },
  { label: "10-15 min", shortLabel: "10–15", minSeconds: 600, maxSeconds: 900 },
  { label: "15-30 min", shortLabel: "15–30", minSeconds: 900, maxSeconds: 1800 },
  { label: "30-60 min", shortLabel: "30–60", minSeconds: 1800, maxSeconds: 3600 },
  { label: "60+ min", shortLabel: "60+", minSeconds: 3600, maxSeconds: null },
] as const;

/** Weekday peak windows, local time. Inclusive start, exclusive end, 24h. */
export const PEAK_WINDOWS = {
  amPeakStartHour: 6,
  amPeakEndHour: 10,
  pmPeakStartHour: 16,
  pmPeakEndHour: 20,
} as const;

/** Sample size below which the UI shows a "preliminary" warning. */
export const LOW_SAMPLE_THRESHOLD = 30;

/**
 * Maximum wait for a pair to count as a transfer, and the buffer required to
 * call the connection made. SSOT for the aggregator's
 * `maxTransferWindowSeconds` / `minTransferBufferSeconds`.
 */
export const TRANSFER_WINDOW_DEFAULT_SECONDS = 1800;
export const TRANSFER_BUFFER_DEFAULT_SECONDS = 0;

/**
 * Stored when a real-time trip's route maps to no catalog line. Never echo the
 * raw GTFS `route_id` here — it renders as a line called "10".
 */
export const UNKNOWN_LINE_NAME = "Unknown line";

/** GTFS-RT reports speed in metres/second; the UI shows mph. */
export const MPS_TO_MPH = 2.236936;

/** NJT-imposed daily request budgets. */
export const RATE_LIMITS = {
  gtfsRtPerDay: 100_000,
  xmlApiPerDay: 40_000,
  /** Keep at least this fraction of the budget in reserve. */
  headroomFraction: 0.2,
} as const;

export const DISCLAIMER_TEXT =
  "Data sourced from NJ Transit's public feeds. Independent of NJT official reporting. " +
  "Not guaranteed accurate, complete, or real-time.";

/**
 * Every GTFS-RT feed the pipeline records. Anything walking the archive visits
 * each in turn: the snapshot index is keyed `(feed_type, …)`, so per-feed paging
 * keeps a walk an ordered index scan rather than a sort. The assertion below
 * fails to compile if a {@link FeedType} is missing here — a forgotten feed
 * looks like an empty one, and the archive copy would report it fully moved.
 */
export const FEED_TYPES = ["TripUpdates", "VehiclePositions", "ServiceAlerts"] as const;

type UnlistedFeedType = Exclude<FeedType, (typeof FEED_TYPES)[number]>;
const _everyFeedTypeIsListed: UnlistedFeedType extends never ? true : never = true;
void _everyFeedTypeIsListed;

/**
 * How long TripUpdates may be silent before ingest counts as stalled. Shared
 * because the pipeline alerts on it and the API reports it at `/health/live`.
 * An hour is many times the 30-second poll interval, so a transient NJT outage
 * or a restart does not trip it.
 */
export const NO_TRIP_UPDATES_ALERT_MS = 3_600_000;
