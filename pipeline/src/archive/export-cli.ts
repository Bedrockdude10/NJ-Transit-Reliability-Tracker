import { consoleLogger } from "@njt/shared/logger";
import { availableServiceDates, exportEvents, type ObjectStore } from "./export-events";

/**
 * CLI: publish derived events to object storage for the modelling repo.
 *
 *   npm run export:events                      # every service date
 *   npm run export:events -- --from 2026-08-01 # from a date onwards
 *
 * Re-running a date replaces its object, so this is safe to schedule and safe to
 * rerun after a backfill.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See the Backups section of DEPLOY.md.`);
    process.exit(1);
  }
  return value;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * The same four `NJT_R2_*` variables Litestream reads.
 *
 * Litestream wants an endpoint with a scheme; DuckDB's S3 client wants a bare
 * host. Rather than asking for both and documenting the difference — which is a
 * trap, not a configuration — the scheme is taken off here and its presence
 * decides TLS.
 */
const endpoint = required("NJT_R2_ENDPOINT");
const store: ObjectStore = {
  bucket: required("NJT_R2_BUCKET"),
  endpoint: endpoint.replace(/^https?:\/\//, ""),
  accessKeyId: required("NJT_R2_ACCESS_KEY_ID"),
  secretAccessKey: required("NJT_R2_SECRET_ACCESS_KEY"),
  region: process.env.NJT_R2_REGION ?? "auto",
  useSsl: !endpoint.startsWith("http://"),
};

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const from = flag("from");

const all = await availableServiceDates(dbPath);
const serviceDates = from ? all.filter((date) => date >= from) : all;

if (serviceDates.length === 0) {
  consoleLogger.warn("nothing to export", { dbPath, from });
  process.exit(0);
}

await exportEvents({ dbPath, store, serviceDates, log: consoleLogger });
