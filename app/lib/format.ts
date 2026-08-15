/** Display formatters. Pure functions — no React Native imports. */

import { NJT_TIMEZONE, type PublishedCoverage } from "@njt/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A bare duration: "2m 30s", "1m", "45s". Absolute — no sign, no words.
 *
 * The shared core of every duration on the site, so "1m 30s" is spelled one way
 * whether it is a delay, an error against a prediction, or a horizon.
 */
export function formatDurationShort(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  return minutes > 0 ? (rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`) : `${rem}s`;
}

/** Human delay: "on time", "2m 30s late", "1m early", or "—" for unknown. */
export function formatDelaySeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (Math.abs(seconds) <= 30) return "on time";
  const core = formatDurationShort(seconds);
  return seconds < 0 ? `${core} early` : `${core} late`;
}

/**
 * Compact delay for tight spaces (KPI tiles): "14m 51s", "2m", "0", or "−1m"
 * for early. Drops the "late"/"early" words since the label provides context.
 */
export function formatDelayShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (Math.abs(seconds) <= 30) return "0";
  const core = formatDurationShort(seconds);
  return seconds < 0 ? `−${core}` : core;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}

/** "2025-07-15" -> "Jul 15". */
export function formatShortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? "?"} ${Number(m[3])}`;
}

/** "2025-07-15" -> "Jul 15, 2025". */
export function formatDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? "?"} ${Number(m[3])}, ${m[1]}`;
}

/** "2025-07-15" -> "Jul 2025". */
export function formatMonth(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? "?"} ${m[1]}`;
}

export function formatTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "never";
  return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Wall-clock time at a station, e.g. "5:42 PM". Rendered in NJT local time
 * (`America/New_York`) rather than the viewer's zone: a board is about the
 * platform you are standing on, and a rider checking from another timezone
 * still wants the time printed on the timetable.
 */
export function formatClockTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "—";
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: NJT_TIMEZONE,
  });
}

/**
 * What period NJT's own published figures actually cover.
 *
 * Always returns a label, never null-when-fine. The previous version only spoke
 * up when the months fell outside the selected range, which left two problems.
 * It said nothing at all when the overlap was merely partial — a 90-day window
 * starting mid-May counts May as "in range" and dropped the caveat while still
 * showing a figure for all of May. And as a bare line of text under an unlabelled
 * row of tiles, "NJT hasn't published this period yet" read as a statement about
 * the whole screen, as though the live measurements above it were stale too.
 *
 * Stating the period unconditionally, as the subtitle of the card holding those
 * figures, removes both: the scope is structural rather than prose, and there is
 * no boundary at which the label silently switches off.
 */
export function officialPeriodLabel(coverage: PublishedCoverage | null | undefined): string | null {
  if (!coverage) return null;
  const span =
    coverage.fromMonth === coverage.toMonth
      ? formatMonth(coverage.fromMonth)
      : `${formatMonth(coverage.fromMonth)} – ${formatMonth(coverage.toMonth)}`;
  // NJT publishes months in arrears, so the newest available month routinely
  // predates the window. Say so where it is true, without implying anything
  // about the independently measured figures elsewhere on the page.
  return coverage.outsideRequestedRange
    ? `${span} — NJT's most recent published month, before your selected window`
    : span;
}

/** "reduced_service" -> "Reduced service". */
export function humanizeEffect(effect: string): string {
  const spaced = effect.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
