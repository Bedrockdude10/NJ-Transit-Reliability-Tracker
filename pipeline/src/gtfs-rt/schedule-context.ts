import type { GtfsRepository } from "@njt/db";
import { gtfsStopTimeToEpochSeconds } from "@njt/shared";
import { directionFromId, type ScheduleContext, type TripSchedule } from "./parse";

/**
 * Cross-tick cache backing {@link createScheduleContext}. Resolving a trip's
 * schedule hits the DB (trip meta + every stop time) and recomputes absolute
 * instants; TripUpdates is polled continuously and the same trips recur every
 * tick, so without a persistent cache we'd redo that work — and warm the stop
 * name cache from scratch — on every poll. Keyed implicitly by GTFS version:
 * the cache is cleared on version rollover so stale schedules never leak.
 */
export interface ScheduleCache {
  /** `${serviceDate}|${tripId}` → resolved schedule (null memoized too). */
  schedules: Map<string, TripSchedule | null>;
  /** stopId → resolved stop name (or the raw id fallback). */
  stopNames: Map<string, string>;
  /** GTFS version the cached entries belong to; rollover invalidates them. */
  versionId: string | undefined;
}

/** A fresh, empty schedule cache to hold across ingest ticks. */
export function createScheduleCache(): ScheduleCache {
  return { schedules: new Map(), stopNames: new Map(), versionId: undefined };
}

/**
 * A {@link ScheduleContext} backed by the current GTFS static version. Resolves
 * a trip's scheduled stop times (as absolute epoch seconds for the service
 * date) so the parser can compute delays even when the RT feed omits them.
 *
 * Pass a {@link ScheduleCache} to reuse resolved schedules and stop names
 * across polls; it self-invalidates when the current GTFS version changes. When
 * omitted a private cache is used (single-context behaviour, e.g. in tests).
 */
export function createScheduleContext(
  gtfs: GtfsRepository,
  cache: ScheduleCache = createScheduleCache(),
): ScheduleContext {
  const versionId = gtfs.currentVersion()?.versionId;

  // Version rollover: drop everything resolved against the prior version.
  if (cache.versionId !== versionId) {
    cache.schedules.clear();
    cache.stopNames.clear();
    cache.versionId = versionId;
  }

  const resolve = (tripId: string, serviceDate: string): TripSchedule | null => {
    if (!versionId) return null;
    const meta = gtfs.tripMeta(versionId, tripId);
    if (!meta) return null;
    const stopTimes = gtfs.stopTimesForTrip(versionId, tripId);
    if (stopTimes.length === 0) return null;

    return {
      routeId: meta.routeId,
      lineName: gtfs.lineNameForRoute(versionId, meta.routeId) ?? meta.routeId,
      direction: directionFromId(meta.directionId),
      stops: stopTimes.map((st) => ({
        stopId: st.stopId,
        stopSequence: st.stopSequence,
        scheduledArrival: st.arrivalTime ? gtfsStopTimeToEpochSeconds(serviceDate, st.arrivalTime) : null,
        scheduledDeparture: st.departureTime ? gtfsStopTimeToEpochSeconds(serviceDate, st.departureTime) : null,
      })),
    };
  };

  return {
    lookup(tripId: string, serviceDate: string): TripSchedule | null {
      if (!versionId) return null;
      const key = `${serviceDate}|${tripId}`;
      // `has` distinguishes a memoized `null` (unknown trip) from a cache miss,
      // so mismatched trips aren't re-resolved every tick either.
      if (cache.schedules.has(key)) return cache.schedules.get(key) ?? null;
      const schedule = resolve(tripId, serviceDate);
      cache.schedules.set(key, schedule);
      return schedule;
    },

    stopName(stopId: string): string {
      if (!versionId) return stopId;
      let name = cache.stopNames.get(stopId);
      if (name === undefined) {
        name = gtfs.stopName(versionId, stopId) ?? stopId;
        cache.stopNames.set(stopId, name);
      }
      return name;
    },
  };
}
