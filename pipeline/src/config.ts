/**
 * Pipeline configuration, loaded from environment variables with sensible
 * defaults. Credentials are read from the environment only — never committed
 * (PRD compliance). See `.env.example`.
 */
export interface PipelineConfig {
  dbPath: string;
  gtfsRtApiKey: string | undefined;
  xmlApiKey: string | undefined;
  urls: {
    tripUpdates: string;
    vehiclePositions: string;
    serviceAlerts: string;
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
    gtfsRtApiKey: env.NJT_GTFS_RT_API_KEY,
    xmlApiKey: env.NJT_XML_API_KEY,
    urls: {
      tripUpdates: env.NJT_TRIP_UPDATES_URL ?? "",
      vehiclePositions: env.NJT_VEHICLE_POSITIONS_URL ?? "",
      serviceAlerts: env.NJT_SERVICE_ALERTS_URL ?? "",
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
    noTripUpdatesAlertMs: num(env.NJT_NO_TRIP_UPDATES_ALERT_MS, 3_600_000),
    alertWebhookUrl: env.NJT_ALERT_WEBHOOK_URL,
  };
}
