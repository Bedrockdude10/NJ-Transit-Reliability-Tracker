import type { GtfsRepository } from "@njt/db";
import { gtfsStopTimeToEpochSeconds } from "@njt/shared/zoned";
import { directionFromId, type ResolvedRoute, type ScheduleContext, type TripSchedule } from "./parse";

/**
 * Cross-tick cache: the same trips recur every poll, and resolving one hits trip meta
 * plus every stop time. Cleared on GTFS version rollover so stale schedules can't leak.
 */
export interface ScheduleCache {
  /** `${serviceDate}|${tripId}` → resolved schedule (null memoized too). */
  schedules: Map<string, TripSchedule | null>;
  stopNames: Map<string, string>;
  routes: Map<string, ResolvedRoute | null>;
  versionId: string | undefined;
}

export function createScheduleCache(): ScheduleCache {
  return { schedules: new Map(), stopNames: new Map(), routes: new Map(), versionId: undefined };
}

/**
 * Resolves a trip's stop times to absolute epoch seconds, so the parser can compute
 * delay even when the RT feed omits it.
 */
export function createScheduleContext(
  gtfs: GtfsRepository,
  cache: ScheduleCache = createScheduleCache(),
  /**
   * Replay needs the version effective when the snapshot was recorded: trip ids are
   * reused across schedule revisions and would otherwise resolve to the wrong service.
   */
  versionIdOverride?: string,
): ScheduleContext {
  const versionId = versionIdOverride ?? gtfs.currentVersion()?.versionId;

  if (cache.versionId !== versionId) {
    cache.schedules.clear();
    cache.stopNames.clear();
    cache.routes.clear();
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
      // `has`, not `get`: memoizes `null` so unknown trips aren't re-resolved per tick.
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

    resolveRoute(routeId: string): ResolvedRoute | null {
      if (!versionId || !routeId) return null;
      if (cache.routes.has(routeId)) return cache.routes.get(routeId) ?? null;

      const canonicalId = gtfs.lineNameForRoute(versionId, routeId)
        ? routeId
        : (gtfs.canonicalRouteFor(versionId, routeId) ?? null);
      const lineName = canonicalId ? gtfs.lineNameForRoute(versionId, canonicalId) : null;

      const resolved = canonicalId && lineName ? { routeId: canonicalId, lineName } : null;
      cache.routes.set(routeId, resolved);
      return resolved;
    },
  };
}
