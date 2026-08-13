/** Display formatters. Pure functions — no React Native imports. */

import { NJT_TIMEZONE, type PublishedCoverage } from "@njt/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Human delay: "on time", "2m 30s late", "1m early", or "—" for unknown. */
export function formatDelaySeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (Math.abs(seconds) <= 30) return "on time";
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  const core = minutes > 0 ? (rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`) : `${rem}s`;
  return seconds < 0 ? `${core} early` : `${core} late`;
}

/**
 * Compact delay for tight spaces (KPI tiles): "14m 51s", "2m", "0", or "−1m"
 * for early. Drops the "late"/"early" words since the label provides context.
 */
export function formatDelayShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (Math.abs(seconds) <= 30) return "0";
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  const core = minutes > 0 ? (rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`) : `${rem}s`;
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
 * Caption for an official (monthly) figure whose months fall outside the
 * selected date range. NJT publishes in arrears, so the API substitutes its
 * newest published month — that substitution must be visible, or a May figure
 * reads as if it described the July window the user asked for.
 *
 * Returns null when the figure really does cover the requested range.
 */
export function coverageNote(coverage: PublishedCoverage | null | undefined): string | null {
  if (!coverage || !coverage.outsideRequestedRange) return null;
  const span =
    coverage.fromMonth === coverage.toMonth ? coverage.fromMonth : `${coverage.fromMonth}–${coverage.toMonth}`;
  return `NJT hasn't published this period yet — showing ${span}, its most recent.`;
}

/** "reduced_service" -> "Reduced service". */
export function humanizeEffect(effect: string): string {
  const spaced = effect.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
