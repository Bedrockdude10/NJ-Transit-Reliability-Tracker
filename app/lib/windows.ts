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

/**
 * Default window for the primary summary screens (system / line / station).
 * Deliberately wide: NJT publishes its official metrics monthly and with a lag,
 * so a short trailing window can miss the latest published month entirely and
 * the page reads as empty even when the database is full. A year always overlaps
 * published history, so a populated DB is never blank on load.
 */
export const DEFAULT_WINDOW_KEY: WindowKey = "1y";

/** Days for a window key (falls back to the 1-year default). */
export function windowDays(key: WindowKey): number {
  return WINDOWS.find((w) => w.key === key)?.days ?? 365;
}

export function todayString(nowMs: number = Date.now()): string {
  return toLocalDateString(Math.floor(nowMs / 1000));
}

/** Convert a trailing window (in days) ending today into a {from,to} range. */
export function windowToRange(days: number, today: string = todayString()): Required<DateRange> {
  return { from: addDays(today, -(days - 1)), to: today };
}
