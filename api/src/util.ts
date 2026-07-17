/** Small API-wide helpers. */

import { HEATMAP_TYPES, type HeatmapType } from "@njt/shared";

/** Re-exported so API modules keep importing it from `./util`, but there is one
 * definition (in `@njt/shared`) shared with the app — precision never drifts. */
export { round1 } from "@njt/shared";

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

/**
 * Parse a `?limit=` query value: falls back when absent/invalid/<1, floors,
 * and clamps to a maximum of 100.
 */
export function parseLimit(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100);
}

/** Parse a `?type=` heatmap query value, defaulting to `hour_of_day`. */
export function parseHeatmapType(value: string | undefined): HeatmapType {
  const type = value ?? "hour_of_day";
  if (!HEATMAP_TYPES.includes(type as HeatmapType)) badRequest(`type must be one of ${HEATMAP_TYPES.join(", ")}`);
  return type as HeatmapType;
}
