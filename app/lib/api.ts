import type {
  AlertFrequencyResponse,
  AlertListResponse,
  ConnectionResponse,
  ConnectionTopResponse,
  HealthResponse,
  HeatmapResponse,
  HeatmapType,
  HistoryResponse,
  LightRailSummaryResponse,
  LineListResponse,
  LineMonthlyResponse,
  MapResponse,
  LineSummaryResponse,
  LineTrendResponse,
  StationListResponse,
  StationSummaryResponse,
  SystemSummaryResponse,
  WorstTripsResponse,
} from "@njt/shared";
import { API_BASE_URL } from "./config";

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

async function get<T>(path: string, params?: Params): Promise<T> {
  const res = await fetch(buildUrl(path, params));
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Typed client for the backend API. One method per endpoint. */
export const api = {
  health: () => get<HealthResponse>("/health"),
  systemSummary: (r: DateRange) => get<SystemSummaryResponse>("/system/summary", { ...r }),
  systemHeatmap: (r: DateRange, type: HeatmapType) => get<HeatmapResponse>("/system/heatmap", { ...r, type }),
  lines: () => get<LineListResponse>("/lines"),
  map: (r: DateRange) => get<MapResponse>("/map", { ...r }),
  systemHistory: () => get<HistoryResponse>("/system/history"),
  lineHistory: (id: string) => get<HistoryResponse>(`/lines/${encodeURIComponent(id)}/history`),
  lightRailSummary: (r: DateRange) => get<LightRailSummaryResponse>("/lightrail/summary", { ...r }),
  lineSummary: (id: string, r: DateRange) => get<LineSummaryResponse>(`/lines/${encodeURIComponent(id)}/summary`, { ...r }),
  lineTrend: (id: string, r: DateRange, interval: "daily" | "weekly") =>
    get<LineTrendResponse>(`/lines/${encodeURIComponent(id)}/trend`, { ...r, interval }),
  lineMonthly: (id: string) => get<LineMonthlyResponse>(`/lines/${encodeURIComponent(id)}/monthly`),
  lineWorst: (id: string, r: DateRange, limit = 10) =>
    get<WorstTripsResponse>(`/lines/${encodeURIComponent(id)}/trips/worst`, { ...r, limit }),
  lineHeatmap: (id: string, r: DateRange, type: HeatmapType) =>
    get<HeatmapResponse>(`/lines/${encodeURIComponent(id)}/heatmap`, { ...r, type }),
  stations: () => get<StationListResponse>("/stations"),
  stationSummary: (id: string, r: DateRange) => get<StationSummaryResponse>(`/stations/${encodeURIComponent(id)}/summary`, { ...r }),
  stationTopTrips: (id: string, r: DateRange) =>
    get<WorstTripsResponse>(`/stations/${encodeURIComponent(id)}/top-delayed-trips`, { ...r }),
  connections: (q: { inbound_trip_id: string; transfer_stop_id: string; outbound_trip_id: string } & DateRange) =>
    get<ConnectionResponse>("/connections", { ...q }),
  connectionsTop: (limit = 10) => get<ConnectionTopResponse>("/connections/top", { limit }),
  alerts: (q: { line?: string; effect_type?: string; page?: number; pageSize?: number } & DateRange) =>
    get<AlertListResponse>("/alerts", { ...q }),
  alertFrequency: (r: DateRange) => get<AlertFrequencyResponse>("/alerts/frequency", { ...r }),
  exportUrl: (entity: "system" | "line" | "station", r: DateRange, id?: string) =>
    buildUrl("/export", { entity, id, ...r }),
};
