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
  modelAccuracyResponseSchema,
  predictionsResponseSchema,
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

export interface DateRange {
  from?: string;
  to?: string;
}

type Params = Record<string, string | number | undefined>;

/** Avoids the `URL` global, which React Native does not implement fully. */
export function buildUrl(path: string, params: Params = {}): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${API_BASE_URL}${path}${query ? `?${query}` : ""}`;
}

/**
 * A response that did not match the contract in `@njt/shared`. Named so a
 * version skew surfaces as an error naming the field, not as `undefined` deep
 * inside a component rendering an empty panel.
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

/** A request that has not been made yet: its cache key and how to run it. */
export interface ApiQuery<T> {
  /** The URL, so distinct requests can never collide. */
  readonly key: readonly [string];
  readonly run: () => Promise<T>;
}

async function fetchJson<S extends z.ZodType>(schema: S, url: string, path: string): Promise<z.infer<S>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  const parsed = schema.safeParse(await res.json());
  // Zod strips unknown keys, so an API that *adds* a field stays compatible;
  // only a removal or changed type fails here.
  if (!parsed.success) throw new ApiContractError(path, parsed.error.issues);
  return parsed.data;
}

/**
 * Describe a GET. The schema is an argument, not a type parameter: a type
 * parameter can be supplied and still be a lie, whereas omitting the argument
 * will not compile.
 */
function get<S extends z.ZodType>(schema: S, path: string, params?: Params): ApiQuery<z.infer<S>> {
  const url = buildUrl(path, params);
  return { key: [url], run: () => fetchJson(schema, url, path) };
}

export const api = {
  health: () => get(healthResponseSchema, "/health"),
  systemSummary: (r: DateRange) => get(systemSummaryResponseSchema, "/system/summary", { ...r }),
  systemHeatmap: (r: DateRange, type: HeatmapType) => get(heatmapResponseSchema, "/system/heatmap", { ...r, type }),
  lines: () => get(lineListResponseSchema, "/lines"),
  map: (r: DateRange) => get(mapResponseSchema, "/map", { ...r }),
  mapVehicles: (lineId?: string) => get(mapVehiclesResponseSchema, "/map/vehicles", lineId ? { lineId } : {}),
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
    get(stationDeparturesResponseSchema, `/stations/${encodeURIComponent(id)}/departures`, horizonMinutes ? { horizonMinutes } : {}),
  stationSummary: (id: string, r: DateRange) => get(stationSummaryResponseSchema, `/stations/${encodeURIComponent(id)}/summary`, { ...r }),
  stationTopTrips: (id: string, r: DateRange) =>
    get(worstTripsResponseSchema, `/stations/${encodeURIComponent(id)}/top-delayed-trips`, { ...r }),
  commute: (origin: string, destination: string, r: DateRange) =>
    get(commuteResponseSchema, "/commute", { origin, destination, ...r }),
  connections: (q: { inbound_trip_id: string; transfer_stop_id: string; outbound_trip_id: string } & DateRange) =>
    get(connectionResponseSchema, "/connections", { ...q }),
  connectionsTop: (limit = 10) => get(connectionTopResponseSchema, "/connections/top", { limit }),
  alerts: (q: {
      line?: string | undefined;
      effect_type?: string | undefined;
      page?: number;
      pageSize?: number;
    } & DateRange) =>
    get(alertListResponseSchema, "/alerts", { ...q }),
  alertFrequency: (r: DateRange) => get(alertFrequencyResponseSchema, "/alerts/frequency", { ...r }),
  /** Omit `date` for the most recently predicted day — today is usually unpredicted. */
  predictions: (date?: string, line?: string) =>
    get(predictionsResponseSchema, "/predictions", { date, line }),
  /** A model's track record, not its forecast — see `/models`. */
  models: (date?: string) => get(modelAccuracyResponseSchema, "/models", { date }),
  exportUrl: (entity: "system" | "line" | "station", r: DateRange, id?: string) =>
    buildUrl("/export", { entity, id, ...r }),
};
