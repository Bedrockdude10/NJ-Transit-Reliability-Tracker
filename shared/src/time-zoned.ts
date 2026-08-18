/**
 * Local-wall-clock -> instant, the one direction where DST is ambiguous and the
 * only place that needs Temporal.
 *
 * Deliberately **not** re-exported from the package index: Metro bundles whole
 * modules, so a Temporal import reachable from the index put the whole polyfill
 * (+160 KB, 12% of the web bundle) in the app to serve functions it never
 * calls. Reach it as `@njt/shared/zoned`.
 */

import { Temporal } from "@js-temporal/polyfill";
import { NJT_TIMEZONE } from "./constants";
import { type LocalParts, parseDateString, parseGtfsTimeToSeconds } from "./time";

/**
 * Local wall-clock parts -> epoch seconds (UTC).
 *
 * `disambiguation: "compatible"` is the ECMAScript default and what other GTFS
 * consumers do: a nonexistent local time shifts forward past the spring-forward
 * gap, and a repeated one takes the first (pre-transition) occurrence.
 */
export function localPartsToEpochSeconds(
  parts: LocalParts,
  timeZone: string = NJT_TIMEZONE,
): number {
  const zoned = Temporal.PlainDateTime.from({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }).toZonedDateTime(timeZone, { disambiguation: "compatible" });
  return Math.floor(zoned.epochMilliseconds / 1000);
}

/**
 * Memoized per `serviceDate|timeZone`: every stop time on a date shares an
 * anchor and each is resolved twice (arrival + departure).
 */
const MIDNIGHT_CACHE = new Map<string, number>();
const GTFS_ANCHOR_CACHE = new Map<string, number>();

function cached(store: Map<string, number>, key: string, compute: () => number): number {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const value = compute();
  store.set(key, value);
  return value;
}

function atLocalHour(serviceDate: string, hour: number, timeZone: string): number {
  const { year, month, day } = parseDateString(serviceDate);
  return localPartsToEpochSeconds({ year, month, day, hour, minute: 0, second: 0 }, timeZone);
}

/**
 * The instant GTFS counts stop times from: **noon minus twelve hours**, per
 * spec, not midnight. The two differ on a DST transition day, and anchoring at
 * midnight shifts every stop time after the transition by an hour. Noon is
 * never inside a US transition.
 */
function gtfsServiceDayAnchor(serviceDate: string, timeZone: string): number {
  return cached(GTFS_ANCHOR_CACHE, `${serviceDate}|${timeZone}`, () =>
    atLocalHour(serviceDate, 12, timeZone) - 12 * 3600,
  );
}

/** Service date + "HH:MM:SS" (hours may exceed 24) -> epoch seconds. */
export function gtfsStopTimeToEpochSeconds(
  serviceDate: string,
  gtfsTime: string,
  timeZone: string = NJT_TIMEZONE,
): number {
  return gtfsServiceDayAnchor(serviceDate, timeZone) + parseGtfsTimeToSeconds(gtfsTime);
}

/**
 * Local midnight starting a service date, as epoch seconds. A service date is a
 * local calendar day, not a UTC one, so `Date.parse` will not do. Distinct from
 * the GTFS anchor above: this is a real calendar boundary, so a transition day
 * spans 23 or 25 hours.
 */
export function startOfLocalDayEpochSeconds(
  serviceDate: string,
  timeZone: string = NJT_TIMEZONE,
): number {
  return cached(MIDNIGHT_CACHE, `${serviceDate}|${timeZone}`, () =>
    atLocalHour(serviceDate, 0, timeZone),
  );
}
