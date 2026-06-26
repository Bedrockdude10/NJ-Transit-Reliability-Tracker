import { addDays, toLocalDateString } from "@njt/shared";
import type { DateRange } from "./api";

/**
 * Preset time windows for the date selector. "All" reaches back far enough to
 * cover NJT's published history (2017→); the API simply returns whatever data
 * exists within the resulting range.
 */
export const WINDOWS = [
  { key: "7d", days: 7, label: "7d" },
  { key: "30d", days: 30, label: "30d" },
  { key: "90d", days: 90, label: "90d" },
  { key: "1y", days: 365, label: "1y" },
  { key: "all", days: 3653, label: "All" },
] as const;

export type WindowKey = (typeof WINDOWS)[number]["key"];

export function todayString(nowMs: number = Date.now()): string {
  return toLocalDateString(Math.floor(nowMs / 1000));
}

/** Convert a trailing window (in days) ending today into a {from,to} range. */
export function windowToRange(days: number, today: string = todayString()): Required<DateRange> {
  return { from: addDays(today, -(days - 1)), to: today };
}
