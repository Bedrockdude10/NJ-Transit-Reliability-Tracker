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
 * Resolve a window key that arrived from outside the app — a URL, a bookmark,
 * someone else's shared link — to a known preset. Anything unrecognised falls
 * back rather than leaving the screen in a state the picker can't represent.
 */
export function parseWindowKey(value: string | undefined, fallback: WindowKey = "30d"): WindowKey {
  return WINDOWS.some((w) => w.key === value) ? (value as WindowKey) : fallback;
}

/** Days for a window key. */
export function windowDays(key: WindowKey): number {
  return WINDOWS.find((w) => w.key === key)?.days ?? 30;
}

export function todayString(nowMs: number = Date.now()): string {
  return toLocalDateString(Math.floor(nowMs / 1000));
}

/** Convert a trailing window (in days) ending today into a {from,to} range. */
export function windowToRange(days: number, today: string = todayString()): Required<DateRange> {
  return { from: addDays(today, -(days - 1)), to: today };
}
