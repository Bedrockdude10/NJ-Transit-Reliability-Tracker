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
    console.error(`${name} is not set. See DEPLOY.md for the object-storage variables.`);
    process.exit(1);
  }
  return value;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const store: ObjectStore = {
  bucket: required("NJT_ARCHIVE_BUCKET"),
  endpoint: required("NJT_ARCHIVE_ENDPOINT"),
  accessKeyId: required("NJT_ARCHIVE_ACCESS_KEY_ID"),
  secretAccessKey: required("NJT_ARCHIVE_SECRET_ACCESS_KEY"),
  region: process.env.NJT_ARCHIVE_REGION ?? "auto",
  useSsl: process.env.NJT_ARCHIVE_USE_SSL !== "false",
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
