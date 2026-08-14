import {
  alertFrequencyResponseSchema,
  alertListResponseSchema,
  commuteResponseSchema,
  connectionResponseSchema,
  connectionTopResponseSchema,
  healthResponseSchema,
  heatmapResponseSchema,
  historyResponseSchema,
  lightRailSummaryResponseSchema,
  lineListResponseSchema,
  lineMonthlyResponseSchema,
  lineSummaryResponseSchema,
  lineTrendResponseSchema,
  mapResponseSchema,
  mapVehiclesResponseSchema,
  propagationResponseSchema,
  stationDeparturesResponseSchema,
  stationListResponseSchema,
  stationRankingsResponseSchema,
  stationSummaryResponseSchema,
  systemSummaryResponseSchema,
  trendsResponseSchema,
  worstTripsResponseSchema,
  type HeatmapType,
} from "@njt/shared";
import type { z } from "zod";
import { API_BASE_URL } from "./config";
import { RequestCache } from "./request-cache";

export interface DateRange {
  from?: string;
  to?: string;
}

type Params = Record<string, string | number | undefined>;

/** Build a URL with a query string. Avoids the `URL` global for RN compatibility. */
export function buildUrl(path: string, params: Params = {}): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${API_BASE_URL}${path}${query ? `?${query}` : ""}`;
}

/**
 * A response that did not match the contract in `@njt/shared`.
 *
 * The API and the app deploy independently — Fly and Cloudflare Pages — so they
 * can briefly be running different versions of that contract. Without this the
 * mismatch arrives as `undefined` deep inside a component and renders as an
 * empty panel; with it, the screen's existing error state says what is wrong
 * and which field caused it.
 */
export class ApiContractError extends Error {
  constructor(
    readonly path: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    const first = issues[0];
    const where = first?.path.length ? first.path.join(".") : "response";
    super(`API response for ${path} did not match the expected shape at "${where}": ${first?.message}`);
    this.name = "ApiContractError";
  }
}

// Read-only GETs are deduped + briefly cached by URL: concurrent callers (e.g. a
// screen and the global footer both requesting /health) share one request, and
// re-running an effect over a list of ids where only one changed hits at most
// one network request per id.
const cache = new RequestCache();

async function fetchJson<S extends z.ZodType>(schema: S, url: string, path: string): Promise<z.infer<S>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  const parsed = schema.safeParse(await res.json());
  // Zod strips unknown keys rather than rejecting them, so an API that *adds* a
  // field stays compatible. Only a removal or a changed type fails here — and
  // those would have broken the render anyway, silently.
  if (!parsed.success) throw new ApiContractError(path, parsed.error.issues);
  return parsed.data;
}

/**
 * Every request carries its response schema. Taking it as an argument rather
 * than a type parameter is the point: a type parameter can be supplied and
 * still be a lie, whereas omitting the schema here will not compile.
 */
async function get<S extends z.ZodType>(schema: S, path: string, params?: Params): Promise<z.infer<S>> {
  const url = buildUrl(path, params);
  return cache.get(url, () => fetchJson(schema, url, path));
}

/**
 * A GET that must never be served from cache. Live endpoints (departures,
 * vehicle positions) refresh on a timer, and a 30s cache would hand the timer
 * back the same payload it already has. Concurrent callers still dedupe.
 */
async function getLive<S extends z.ZodType>(schema: S, path: string, params?: Params): Promise<z.infer<S>> {
  const url = buildUrl(path, params);
  return cache.live(url, () => fetchJson(schema, url, path));
}

/** Typed client for the backend API. One method per endpoint. */
export const api = {
  health: () => get(healthResponseSchema, "/health"),
  systemSummary: (r: DateRange) => get(systemSummaryResponseSchema, "/system/summary", { ...r }),
  systemHeatmap: (r: DateRange, type: HeatmapType) => get(heatmapResponseSchema, "/system/heatmap", { ...r, type }),
  lines: () => get(lineListResponseSchema, "/lines"),
  map: (r: DateRange) => get(mapResponseSchema, "/map", { ...r }),
  mapVehicles: (lineId?: string) => getLive(mapVehiclesResponseSchema, "/map/vehicles", lineId ? { lineId } : {}),
  systemTrends: (days?: number) => get(trendsResponseSchema, "/system/trends", days ? { days } : {}),
  systemHistory: () => get(historyResponseSchema, "/system/history"),
  lineHistory: (id: string) => get(historyResponseSchema, `/lines/${encodeURIComponent(id)}/history`),
  lightRailSummary: (r: DateRange) => get(lightRailSummaryResponseSchema, "/lightrail/summary", { ...r }),
  lineSummary: (id: string, r: DateRange) => get(lineSummaryResponseSchema, `/lines/${encodeURIComponent(id)}/summary`, { ...r }),
  lineTrend: (id: string, r: DateRange, interval: "daily" | "weekly") =>
    get(lineTrendResponseSchema, `/lines/${encodeURIComponent(id)}/trend`, { ...r, interval }),
  lineMonthly: (id: string) => get(lineMonthlyResponseSchema, `/lines/${encodeURIComponent(id)}/monthly`),
  lineWorst: (id: string, r: DateRange, limit = 10) =>
    get(worstTripsResponseSchema, `/lines/${encodeURIComponent(id)}/trips/worst`, { ...r, limit }),
  linePropagation: (id: string, r: DateRange, direction: "inbound" | "outbound") =>
    get(propagationResponseSchema, `/lines/${encodeURIComponent(id)}/propagation`, { ...r, direction }),
  lineHeatmap: (id: string, r: DateRange, type: HeatmapType) =>
    get(heatmapResponseSchema, `/lines/${encodeURIComponent(id)}/heatmap`, { ...r, type }),
  stations: () => get(stationListResponseSchema, "/stations"),
  stationRankings: (r: DateRange, sort: "delay" | "amplification") =>
    get(stationRankingsResponseSchema, "/stations/rankings", { ...r, sort }),
  stationDepartures: (id: string, horizonMinutes?: number) =>
    getLive(stationDeparturesResponseSchema, `/stations/${encodeURIComponent(id)}/departures`, horizonMinutes ? { horizonMinutes } : {}),
  stationSummary: (id: string, r: DateRange) => get(stationSummaryResponseSchema, `/stations/${encodeURIComponent(id)}/summary`, { ...r }),
  stationTopTrips: (id: string, r: DateRange) =>
    get(worstTripsResponseSchema, `/stations/${encodeURIComponent(id)}/top-delayed-trips`, { ...r }),
  commute: (origin: string, destination: string, r: DateRange) =>
    get(commuteResponseSchema, "/commute", { origin, destination, ...r }),
  connections: (q: { inbound_trip_id: string; transfer_stop_id: string; outbound_trip_id: string } & DateRange) =>
    get(connectionResponseSchema, "/connections", { ...q }),
  connectionsTop: (limit = 10) => get(connectionTopResponseSchema, "/connections/top", { limit }),
  alerts: (q: { line?: string; effect_type?: string; page?: number; pageSize?: number } & DateRange) =>
    get(alertListResponseSchema, "/alerts", { ...q }),
  alertFrequency: (r: DateRange) => get(alertFrequencyResponseSchema, "/alerts/frequency", { ...r }),
  exportUrl: (entity: "system" | "line" | "station", r: DateRange, id?: string) =>
    buildUrl("/export", { entity, id, ...r }),
};
