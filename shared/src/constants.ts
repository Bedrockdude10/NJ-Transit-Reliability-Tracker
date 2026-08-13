/** Project-wide constants. */

/** IANA timezone for all NJT service. Used for service-date and hour-of-day math. */
export const NJT_TIMEZONE = "America/New_York";

/**
 * On-time thresholds (seconds) at which we compute OTP. The whole point of the
 * project is showing OTP at these stricter thresholds next to NJT's loose one.
 */
export const OTP_THRESHOLDS_SECONDS = [300, 600, 900, 1800, 3600] as const;
export type OtpThresholdSeconds = (typeof OTP_THRESHOLDS_SECONDS)[number];

/** NJT's own published threshold: "on time" means within 6 minutes. */
export const NJT_OFFICIAL_THRESHOLD_SECONDS = 360;

/**
 * The strict headline threshold (5 minutes) at which the project computes its
 * primary OTP figure, and the arrival window for the connection amplification
 * test. SSOT for the pipeline's `ON_TIME_SECS` and the default late threshold.
 */
export const OTP_STRICT_THRESHOLD_SECONDS = 300;

/**
 * OTP color-band thresholds (percent). At or above `good` renders green, at or
 * above `fair` renders amber, below is red. SSOT for `otpColor*` in the app.
 */
export const OTP_GOOD_THRESHOLD_PERCENT = 90;
export const OTP_FAIR_THRESHOLD_PERCENT = 75;

export const DIRECTIONS = ["inbound", "outbound"] as const;

/** Rolling/daily windows the aggregator maintains and the API serves. */
export const WINDOW_KINDS = [
  "daily",
  "rolling_7d",
  "rolling_30d",
  "rolling_90d",
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

/** Number of days each rolling window spans (daily = 1). */
export const WINDOW_DAYS: Record<WindowKind, number> = {
  daily: 1,
  rolling_7d: 7,
  rolling_30d: 30,
  rolling_90d: 90,
};

export const SCOPE_KINDS = ["system", "line"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
/** Stable scope id used for the system-wide rollup. */
export const SYSTEM_SCOPE_ID = "system";

export const HEATMAP_TYPES = ["hour_of_day", "day_of_week"] as const;
export type HeatmapType = (typeof HEATMAP_TYPES)[number];

/**
 * Delay distribution buckets, in seconds. `maxSeconds: null` means open-ended.
 * Ranges are [minSeconds, maxSeconds). The "early" bucket captures trains that
 * beat the schedule.
 */
export interface DelayBucket {
  label: string;
  /** Compact label for dense axes/legends (SSOT for the app's histogram). */
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

/**
 * Weekday peak service windows (local time), used to split connection
 * reliability into peak vs off-peak. Inclusive start, exclusive end, 24h.
 */
export const PEAK_WINDOWS = {
  amPeakStartHour: 6,
  amPeakEndHour: 10,
  pmPeakStartHour: 16,
  pmPeakEndHour: 20,
} as const;

/** Connection sample size below which the UI shows a "preliminary" warning. */
export const LOW_SAMPLE_THRESHOLD = 30;

/**
 * Connection reliability defaults: the maximum wait (seconds) between an
 * inbound arrival and an outbound departure for the pair to count as a
 * transfer, and the minimum buffer required to call the connection made.
 * SSOT for the aggregator's `maxTransferWindowSeconds` / `minTransferBufferSeconds`.
 */
export const TRANSFER_WINDOW_DEFAULT_SECONDS = 1800;
export const TRANSFER_BUFFER_DEFAULT_SECONDS = 0;

/**
 * Line name stored when a real-time trip's route maps to no catalog line.
 * Explicitly unknown beats echoing the raw GTFS `route_id`, which used to be
 * persisted as if it were a line name (a station showing a line called "10").
 */
export const UNKNOWN_LINE_NAME = "Unknown line";

/** GTFS-RT reports speed in metres/second; the UI shows mph. */
export const MPS_TO_MPH = 2.236936;

/** GTFS-RT and XML API daily request budgets (PRD compliance). */
export const RATE_LIMITS = {
  gtfsRtPerDay: 100_000,
  xmlApiPerDay: 40_000,
  /** Keep at least this fraction of the budget in reserve. */
  headroomFraction: 0.2,
} as const;

export const DISCLAIMER_TEXT =
  "Data sourced from NJ Transit's public feeds. Independent of NJT official reporting. " +
  "Not guaranteed accurate, complete, or real-time.";
