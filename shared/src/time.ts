/**
 * Timezone-aware time utilities.
 *
 * Dependency-free: everything here is `Intl` or plain `Date` arithmetic.
 * Instant -> local parts is unambiguous, so it needs nothing more. The reverse
 * direction is where DST bites and lives in `time-zoned.ts`, kept separate so
 * the app bundle does not carry a Temporal polyfill it never calls.
 *
 * GTFS encodes stop times as "HH:MM:SS" where the hour may exceed 23 (e.g.
 * "25:30:00" is 1:30am the following calendar day, still belonging to the prior
 * service date). All instants in the system are epoch seconds (UTC); these
 * helpers convert between that, GTFS service dates, and NJT local wall-clock.
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

/** Break an epoch-seconds instant into local wall-clock parts for a timezone. */
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

/** Local calendar date (`YYYY-MM-DD`) of an epoch-seconds instant. */
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

/** Parse "YYYY-MM-DD" into numeric parts. Throws on malformed input. */
export function parseDateString(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid service date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Parse a GTFS time string ("HH:MM:SS", hours may be >= 24) into seconds past
 * midnight of the service date.
 */
export function parseGtfsTimeToSeconds(time: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`Invalid GTFS time: ${time}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Day of week for an instant in a timezone. 0 = Sunday … 6 = Saturday. */
export function localDayOfWeek(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): number {
  const p = getLocalParts(epochSeconds, timeZone);
  // Date.UTC with the local Y/M/D gives a stable weekday independent of tz.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Hour of day (0-23) for an instant in a timezone. */
export function localHourOfDay(
  epochSeconds: number,
  timeZone: string = NJT_TIMEZONE,
): number {
  return getLocalParts(epochSeconds, timeZone).hour;
}

/** True when the instant falls in a weekday AM or PM peak window. */
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

/** Add `days` to a "YYYY-MM-DD" string, returning a new "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDateString(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Inclusive list of "YYYY-MM-DD" strings from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  // Guard against inverted ranges producing an infinite loop.
  for (let i = 0; cursor <= end && i < 100_000; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
