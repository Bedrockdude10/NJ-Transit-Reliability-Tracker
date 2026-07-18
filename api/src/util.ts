/** Small API-wide helpers. */

import { HEATMAP_TYPES, type HeatmapType } from "@njt/shared";

/**
 * Cache-Control for stable, expensive endpoints backed by daily aggregates.
 * A short cache window (with a day of stale-while-revalidate) — daily rollups
 * change at most once per service date, so brief caching is safe. NOT applied
 * to /health, which must reflect live pipeline state.
 */
export const CACHE_CONTROL_DAILY = "public, max-age=3600, stale-while-revalidate=86400";

/** An error carrying an HTTP status, thrown by handlers and mapped to JSON. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string): never {
  throw new ApiError(400, message);
}

export function notFound(message: string): never {
  throw new ApiError(404, message);
}

/** URL-safe slug from a human line name, used when the catalog has no match. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Round to one decimal place — percentages and average-delay values. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Parse a positive-integer query value (page, pageSize, limit): falls back when
 * absent/invalid/<1, floors fractional input (so it never yields a fractional
 * OFFSET/page), and clamps to `max` when one is given.
 */
export function parsePositiveInt(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Parse a `?limit=` query value: falls back when absent/invalid/<1, floors,
 * and clamps to a maximum of 100.
 */
export function parseLimit(value: string | undefined, fallback: number): number {
  return parsePositiveInt(value, fallback, 100);
}

/** Parse a `?type=` heatmap query value, defaulting to `hour_of_day`. */
export function parseHeatmapType(value: string | undefined): HeatmapType {
  const type = value ?? "hour_of_day";
  if (!HEATMAP_TYPES.includes(type as HeatmapType)) badRequest(`type must be one of ${HEATMAP_TYPES.join(", ")}`);
  return type as HeatmapType;
}
