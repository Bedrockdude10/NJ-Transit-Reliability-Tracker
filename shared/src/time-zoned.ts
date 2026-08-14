/**
 * Local-wall-clock -> instant conversion, the one direction where DST is
 * genuinely ambiguous and the one place that needs Temporal.
 *
 * This lives apart from `time.ts`, and is deliberately **not** re-exported from
 * the package index, because `app` imports `@njt/shared` and Metro bundles
 * whole modules: a top-level Temporal import reachable from the index put the
 * entire polyfill in the web bundle (measured at +160 KB, 12% of it) to serve
 * functions the app never calls. Only `pipeline` and `api` resolve schedules,
 * so only they pay for it — `import { ... } from "@njt/shared/zoned"`.
 *
 * The other direction (instant -> parts) has no ambiguity and is the hot path
 * across millions of events during aggregation, so it stays on cached `Intl`
 * in `time.ts`.
 */

import { Temporal } from "@js-temporal/polyfill";
import { NJT_TIMEZONE } from "./constants";
import { type LocalParts, parseDateString, parseGtfsTimeToSeconds } from "./time";

/**
 * Convert local wall-clock parts in a timezone to epoch seconds (UTC).
 *
 * The previous hand-rolled version refined a UTC guess by one offset lookup and
 * documented itself as wrong inside the fall-back hour. Measuring it showed the
 * opposite: fall-back resolved correctly and *spring-forward* was wrong,
 * mapping the 02:00-03:00 local hour (which does not exist) an hour early, so
 * 02:30 read back as 01:30 — placing a train before the time it was asked for.
 *
 * `disambiguation: "compatible"` is the ECMAScript default and matches what
 * other GTFS consumers do: a nonexistent local time shifts forward past the
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
 * Anchors are memoized per `serviceDate|timeZone`: every stop time on a service
 * date shares one, and each is resolved twice (arrival + departure), so caching
 * removes nearly all of this work during aggregation and schedule resolution.
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
 * The instant GTFS counts stop times from: **noon minus twelve hours**, not
 * midnight.
 *
 * The spec defines it that way precisely because of DST. On an ordinary day the
 * two are identical, but on a transition day they differ by the shift, and
 * anchoring at midnight moved *every* stop time after the transition by an
 * hour — 08:00 resolving to 09:00 each spring and 07:00 each autumn. That is
 * twice a year, every train, silently corrupting every delay measured on those
 * days. Noon is never inside a US transition, so anchoring there and
 * subtracting twelve hours lands correctly either way.
 */
function gtfsServiceDayAnchor(serviceDate: string, timeZone: string): number {
  return cached(GTFS_ANCHOR_CACHE, `${serviceDate}|${timeZone}`, () =>
    atLocalHour(serviceDate, 12, timeZone) - 12 * 3600,
  );
}

/**
 * Resolve a GTFS stop time (service date + "HH:MM:SS", hours may exceed 24) to
 * an absolute epoch-seconds instant in the given timezone.
 */
export function gtfsStopTimeToEpochSeconds(
  serviceDate: string,
  gtfsTime: string,
  timeZone: string = NJT_TIMEZONE,
): number {
  return gtfsServiceDayAnchor(serviceDate, timeZone) + parseGtfsTimeToSeconds(gtfsTime);
}

/**
 * Local midnight starting a service date, as epoch seconds. The anchor every
 * "what happened on this day?" question resolves against — a service date is a
 * local calendar day, not a UTC one, so this cannot be done with `Date.parse`.
 *
 * Distinct from the GTFS anchor above: this one is a real calendar boundary
 * (so transition days span 23 or 25 hours), whereas the GTFS anchor follows the
 * spec's noon-relative rule.
 */
export function startOfLocalDayEpochSeconds(
  serviceDate: string,
  timeZone: string = NJT_TIMEZONE,
): number {
  return cached(MIDNIGHT_CACHE, `${serviceDate}|${timeZone}`, () =>
    atLocalHour(serviceDate, 0, timeZone),
  );
}
