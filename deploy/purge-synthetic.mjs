// One-off maintenance: remove synthetic (seed) measurement data from a database
// that was bootstrapped before live collection existed. Clears the raw events,
// every derived aggregate, and the seeded alerts/health — then resets the
// collection-start marker so it re-anchors to the first real poll.
//
// KEPT (all real): gtfs_* (network), official_* / light_rail_* (NJT's published
// metrics), and pipeline_meta.njt_rail_token (the cached API token).
//
// Safe to run while the API/pipeline are up (quick transaction, busy_timeout);
// the live pipeline repopulates real aggregates from RT going forward.
//
//   node deploy/purge-synthetic.mjs
import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.NJT_DB_PATH ?? "/data/njt.sqlite";

/** Tables holding synthetic measurement data or values derived from it. */
const CLEAR = [
  "trip_stop_events",
  "otp_aggregates",
  "delay_distribution_aggregates",
  "heatmap_aggregates",
  "trip_daily_aggregates",
  "station_daily_aggregates",
  "station_hourly_aggregates",
  "station_distribution_aggregates",
  "connection_aggregates",
  "service_alerts",
  "feed_health",
  "ingest_daily_stats",
  "data_gaps",
];

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000;");

const counts = Object.fromEntries(
  CLEAR.map((t) => [t, db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c]),
);

db.exec("BEGIN IMMEDIATE");
for (const t of CLEAR) db.exec(`DELETE FROM ${t}`);
db.prepare("DELETE FROM pipeline_meta WHERE key = 'collection_start_date'").run();
db.exec("COMMIT");

console.log(`Purged synthetic measurement data from ${dbPath}:`);
for (const t of CLEAR) console.log(`  ${t}: ${counts[t]} rows cleared`);
console.log("Reset pipeline_meta.collection_start_date (re-anchors to the next real poll).");
console.log("Kept: gtfs_* (network), official_* / light_rail_* (official metrics), pipeline_meta.njt_rail_token.");
db.close();
