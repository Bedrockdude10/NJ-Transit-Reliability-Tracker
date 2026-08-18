import { HEATMAP_TYPES, type HeatmapType } from "@njt/shared";

/** For daily-aggregate endpoints only — never /health, which must reflect live pipeline state. */
export const CACHE_CONTROL_DAILY = "public, max-age=3600, stale-while-revalidate=86400";

/** For data refreshed intraday; a longer cache serves superseded rows and fails the app's contract check after a field is added. */
export const CACHE_CONTROL_MINUTE = "public, max-age=60, stale-while-revalidate=300";

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

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parsePositiveInt(value: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseLimit(value: string | undefined, fallback: number): number {
  return parsePositiveInt(value, fallback, 100);
}

export function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export function parseHeatmapType(value: string | undefined): HeatmapType {
  const type = value ?? "hour_of_day";
  if (!HEATMAP_TYPES.includes(type as HeatmapType)) badRequest(`type must be one of ${HEATMAP_TYPES.join(", ")}`);
  return type as HeatmapType;
}
