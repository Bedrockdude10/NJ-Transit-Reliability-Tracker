import type { MapVehicle } from "@njt/shared";

/**
 * Display rules for live train positions.
 *
 * NJ Transit's VehiclePositions feed leaves entries in place after a train
 * stops reporting — production has carried readings nearly eight hours old.
 * Drawing those as current would put phantom trains on the map, so the map
 * filters by age and says how many it hid rather than quietly dropping them.
 */

/** Past this, a position is history rather than "where the train is now". */
export const VEHICLE_STALE_AFTER_SECONDS = 300;

export function isVehicleStale(vehicle: Pick<MapVehicle, "ageSeconds">): boolean {
  // No timestamp at all is untrustworthy for a live view.
  if (vehicle.ageSeconds === null) return true;
  return vehicle.ageSeconds > VEHICLE_STALE_AFTER_SECONDS;
}

export interface LiveVehicleSplit {
  live: MapVehicle[];
  hiddenStale: number;
}

/** Split a feed snapshot into what may be drawn and a count of what was not. */
export function splitLiveVehicles(vehicles: readonly MapVehicle[] | undefined): LiveVehicleSplit {
  if (!vehicles) return { live: [], hiddenStale: 0 };
  const live: MapVehicle[] = [];
  let hiddenStale = 0;
  for (const v of vehicles) {
    if (isVehicleStale(v)) hiddenStale++;
    else live.push(v);
  }
  return { live, hiddenStale };
}

/** Human note for the map footer; null when there is nothing to disclose. */
export function staleVehicleNote(hiddenStale: number): string | null {
  if (hiddenStale <= 0) return null;
  const plural = hiddenStale === 1 ? "train" : "trains";
  return `${hiddenStale} ${plural} hidden — last reported over ${VEHICLE_STALE_AFTER_SECONDS / 60} minutes ago.`;
}
