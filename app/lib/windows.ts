import { addDays, toLocalDateString } from "@njt/shared";
import type { DateRange } from "./api";

/** "All" reaches back to 2017, where NJT's published history starts. */
export const WINDOWS = [
  { key: "7d", days: 7, label: "7d" },
  { key: "30d", days: 30, label: "30d" },
  { key: "90d", days: 90, label: "90d" },
  { key: "1y", days: 365, label: "1y" },
  { key: "all", days: 3653, label: "All" },
] as const;

export type WindowKey = (typeof WINDOWS)[number]["key"];

/**
 * What a summary screen opens at. Wide on purpose: NJT publishes its official
 * metrics monthly and in arrears, so a 30-day window can fall entirely inside
 * the unpublished gap and render a populated database as an empty page.
 */
export const DEFAULT_WINDOW_KEY: WindowKey = "1y";

/**
 * Resolve a key that arrived from a URL or bookmark. Anything unrecognised falls
 * back, so the picker can always represent the state.
 */
export function parseWindowKey(
  value: string | undefined,
  fallback: WindowKey = DEFAULT_WINDOW_KEY,
): WindowKey {
  return WINDOWS.some((w) => w.key === value) ? (value as WindowKey) : fallback;
}

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
