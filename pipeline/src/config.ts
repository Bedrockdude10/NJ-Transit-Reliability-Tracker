/** Configuration from the environment. See `.env.example`. */
import { NO_TRIP_UPDATES_ALERT_MS } from "@njt/shared";

export interface PipelineConfig {
  dbPath: string;
  /** raildata.njtransit.com — token auth, see `pipeline/src/feeds.ts`. */
  railData: {
    username: string | undefined;
    password: string | undefined;
    baseUrl: string;
  };
  xmlApiKey: string | undefined;
  urls: {
    xml: string;
    gtfsStatic: string;
    officialCsv: string;
  };
  intervals: {
    tripUpdatesMs: number;
    vehiclePositionsMs: number;
    serviceAlertsMs: number;
    xmlMs: number;
    hourlyRecomputeMs: number;
    stalenessCheckMs: number;
  };
  /** Alert if no successful TripUpdates ingest within this window. */
  noTripUpdatesAlertMs: number;
  alertWebhookUrl: string | undefined;
}

function num(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  return {
    dbPath: env.NJT_DB_PATH ?? "./data/njt.sqlite",
    railData: {
      username: env.NJT_RAIL_DATA_USERNAME,
      password: env.NJT_RAIL_DATA_PASSWORD,
      baseUrl: (env.NJT_RAIL_DATA_BASE_URL ?? "https://raildata.njtransit.com/api/GTFSRT").replace(/\/+$/, ""),
    },
    xmlApiKey: env.NJT_XML_API_KEY,
    urls: {
      xml: env.NJT_XML_URL ?? "",
      gtfsStatic: env.NJT_GTFS_STATIC_URL ?? "",
      officialCsv: env.NJT_OFFICIAL_CSV_URL ?? "",
    },
    intervals: {
      tripUpdatesMs: num(env.NJT_TRIP_UPDATES_INTERVAL_MS, 30_000),
      vehiclePositionsMs: num(env.NJT_VEHICLE_POSITIONS_INTERVAL_MS, 60_000),
      serviceAlertsMs: num(env.NJT_SERVICE_ALERTS_INTERVAL_MS, 60_000),
      xmlMs: num(env.NJT_XML_INTERVAL_MS, 60_000),
      hourlyRecomputeMs: num(env.NJT_HOURLY_RECOMPUTE_MS, 3_600_000),
      stalenessCheckMs: num(env.NJT_STALENESS_CHECK_MS, 300_000),
    },
    noTripUpdatesAlertMs: num(env.NJT_NO_TRIP_UPDATES_ALERT_MS, NO_TRIP_UPDATES_ALERT_MS),
    alertWebhookUrl: env.NJT_ALERT_WEBHOOK_URL,
  };
}
