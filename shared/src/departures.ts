/**
 * Departure-board logic. Shared rather than API-only so the app can classify a
 * departure it already fetched — a board ticks down between requests — by
 * exactly the rules the server used.
 */

import type { DepartureStatus } from "./api";

/**
 * Deliberately stricter than NJT's 6-minute reporting threshold: the project
 * exists to show the gap between the platform and the official figure.
 */
export const DEPARTURE_LATE_THRESHOLD_SECONDS = 120;

/** Early enough that the train may leave before a rider arrives. */
export const DEPARTURE_EARLY_THRESHOLD_SECONDS = -60;

export interface DepartureStatusInput {
  delaySeconds: number | null;
  tripCancelled: boolean;
  stopSkipped: boolean;
}

export function departureStatus({ delaySeconds, tripCancelled, stopSkipped }: DepartureStatusInput): DepartureStatus {
  if (tripCancelled) return "cancelled";
  if (stopSkipped) return "skipped";
  // Timetabled, but the feed is not tracking it yet.
  if (delaySeconds === null) return "scheduled";
  if (delaySeconds > DEPARTURE_LATE_THRESHOLD_SECONDS) return "late";
  if (delaySeconds < DEPARTURE_EARLY_THRESHOLD_SECONDS) return "early";
  return "on_time";
}

/**
 * Rounded down, so 119 seconds out reads "1 min" rather than "2 min" — a board
 * should never flatter itself. Negative once the time has passed.
 */
export function minutesUntil(epochSeconds: number | null, nowMs: number): number | null {
  if (epochSeconds === null) return null;
  return Math.floor((epochSeconds - Math.floor(nowMs / 1000)) / 60);
}

/** "now", "3 min", "departed", or "—". */
export function formatCountdown(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 0) return "departed";
  if (minutes === 0) return "now";
  return `${minutes} min`;
}
