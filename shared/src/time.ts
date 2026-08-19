/**
 * Timezone-aware time utilities. Dependency-free (`Intl` and `Date` only):
 * instant -> local parts is unambiguous. The reverse direction is where DST
 * bites and lives in `time-zoned.ts`, kept separate so the app bundle does not
 * carry a Temporal polyfill it never calls.
 */

import { NJT_TIMEZONE } from "./constants";

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

const SERVICE_DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const GTFS_TIME_RE = /^(?<hours>\d{1,3}):(?<minutes>[0-5]\d):(?<seconds>[0-5]\d)$/u;

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMATTER_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS_FORMATTER_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

export function getLocalParts(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(epochSeconds * 1000);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    return value ? Number(value) : 0;
  };
  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second"),
  };
}

/** Local calendar date, `YYYY-MM-DD`. */
export function toLocalDateString(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): string {
  const p = getLocalParts(epochSeconds, timeZone);
  return formatDateParts(p.year, p.month, p.day);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Throws on malformed input. */
export function parseDateString(date: string): { year: number; month: number; day: number } {
  const match = SERVICE_DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid service date: ${date}`);
  return { year: Number(match.groups?.year), month: Number(match.groups?.month), day: Number(match.groups?.day) };
}

/**
 * "HH:MM:SS" -> seconds past the service date's start. The hour may exceed 23:
 * "25:30:00" is 1:30am the next calendar day, on the prior service date.
 */
export function parseGtfsTimeToSeconds(time: string): number {
  const match = GTFS_TIME_RE.exec(time);
  if (!match) throw new Error(`Invalid GTFS time: ${time}`);
  return Number(match.groups?.hours) * 3600 + Number(match.groups?.minutes) * 60 + Number(match.groups?.seconds);
}

/** 0 = Sunday … 6 = Saturday. */
export function localDayOfWeek(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): number {
  const p = getLocalParts(epochSeconds, timeZone);
  // Date.UTC on the local Y/M/D gives a weekday independent of the runtime tz.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function localHourOfDay(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): number {
  return getLocalParts(epochSeconds, timeZone).hour;
}

export function isPeak(
  epochSeconds: number,
  peak: { amPeakStartHour: number; amPeakEndHour: number; pmPeakStartHour: number; pmPeakEndHour: number },
  timeZone: string = NJT_TIMEZONE,
): boolean {
  const dow = localDayOfWeek(epochSeconds, timeZone);
  if (dow === 0 || dow === 6) return false; // weekends are never peak
  const hour = localHourOfDay(epochSeconds, timeZone);
  const inAm = hour >= peak.amPeakStartHour && hour < peak.amPeakEndHour;
  const inPm = hour >= peak.pmPeakStartHour && hour < peak.pmPeakEndHour;
  return inAm || inPm;
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDateString(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  // The iteration cap guards an inverted range against looping forever.
  for (let i = 0; cursor <= end && i < 100_000; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
