/**
 * Pure logic for the live departure board.
 *
 * Kept here rather than in the API so the app can classify a departure it has
 * already fetched (a board ticks down between requests) using exactly the rules
 * the server used.
 */

import type { DepartureStatus } from "./api";

/**
 * A train counts as late on the board past this much delay. Deliberately
 * stricter than NJT's 6-minute reporting threshold: a rider standing on a
 * platform cares about two minutes, and the project exists to show the gap
 * between lived experience and the official figure.
 */
export const DEPARTURE_LATE_THRESHOLD_SECONDS = 120;

/** Early enough to be worth flagging — a train that may leave before you arrive. */
export const DEPARTURE_EARLY_THRESHOLD_SECONDS = -60;

export interface DepartureStatusInput {
  delaySeconds: number | null;
  tripCancelled: boolean;
  stopSkipped: boolean;
}

export function departureStatus({ delaySeconds, tripCancelled, stopSkipped }: DepartureStatusInput): DepartureStatus {
  if (tripCancelled) return "cancelled";
  if (stopSkipped) return "skipped";
  // No prediction yet: the trip is timetabled but the feed isn't tracking it.
  if (delaySeconds === null) return "scheduled";
  if (delaySeconds > DEPARTURE_LATE_THRESHOLD_SECONDS) return "late";
  if (delaySeconds < DEPARTURE_EARLY_THRESHOLD_SECONDS) return "early";
  return "on_time";
}

/**
 * Whole minutes until a departure, rounded down so a train 119 seconds out
 * reads "1 min" rather than "2 min" — a board should never flatter itself.
 * Negative once the time has passed. Null when there is nothing to count to.
 */
export function minutesUntil(epochSeconds: number | null, nowMs: number): number | null {
  if (epochSeconds === null) return null;
  return Math.floor((epochSeconds - Math.floor(nowMs / 1000)) / 60);
}

/** "Now", "3 min", "12 min", "departed" — the board's countdown column. */
export function formatCountdown(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 0) return "departed";
  if (minutes === 0) return "now";
  return `${minutes} min`;
}
