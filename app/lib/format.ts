/** Display formatters. Pure functions — no React Native imports. */

import { NJT_TIMEZONE, type PublishedCoverage } from "@njt/shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A bare duration: "2m 30s", "1m", "45s". Absolute — no sign, no words. */
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

/** Compact delay for KPI tiles: "14m 51s", "2m", "0", "−1m". */
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

export function formatShortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? "?"} ${Number(m[3])}`;
}

export function formatDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? "?"} ${Number(m[3])}, ${m[1]}`;
}

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
 * Wall-clock time at a station, e.g. "5:42 PM". Always NJT local time, not the
 * viewer's zone — the rider wants the time printed on the timetable.
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
 * What period NJT's own published figures cover. Always labelled, even when it
 * matches the selected window: partial overlap is otherwise indistinguishable
 * from full, and a caveat that switches off silently reads as one about the
 * whole screen.
 */
export function officialPeriodLabel(coverage: PublishedCoverage | null | undefined): string | null {
  if (!coverage) return null;
  const span =
    coverage.fromMonth === coverage.toMonth
      ? formatMonth(coverage.fromMonth)
      : `${formatMonth(coverage.fromMonth)} – ${formatMonth(coverage.toMonth)}`;
  // NJT publishes months in arrears, so the newest month routinely predates the window.
  return coverage.outsideRequestedRange
    ? `${span} — NJT's most recent published month, before your selected window`
    : span;
}

export function humanizeEffect(effect: string): string {
  const spaced = effect.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
