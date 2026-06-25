import type { GtfsRepository } from "@njt/db";
import { gtfsStopTimeToEpochSeconds } from "@njt/shared";
import { directionFromId, type ScheduleContext, type TripSchedule } from "./parse";

/**
 * A {@link ScheduleContext} backed by the current GTFS static version. Resolves
 * a trip's scheduled stop times (as absolute epoch seconds for the service
 * date) so the parser can compute delays even when the RT feed omits them.
 */
export function createScheduleContext(gtfs: GtfsRepository): ScheduleContext {
  const versionId = gtfs.currentVersion()?.versionId;
  const stopNameCache = new Map<string, string>();

  return {
    lookup(tripId: string, serviceDate: string): TripSchedule | null {
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
    },

    stopName(stopId: string): string {
      if (!versionId) return stopId;
      let name = stopNameCache.get(stopId);
      if (name === undefined) {
        name = gtfs.stopName(versionId, stopId) ?? stopId;
        stopNameCache.set(stopId, name);
      }
      return name;
    },
  };
}
