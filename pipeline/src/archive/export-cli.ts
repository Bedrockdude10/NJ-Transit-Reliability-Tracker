import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { exportEvents } from "./export-events";
import { storeFromEnv } from "./object-store";
import { withLock } from "./run-lock";

/**
 * CLI: publish derived events to object storage for the modelling repo.
 *
 *   npm run export:events                      # every service date
 *   npm run export:events -- --from 2026-08-01 # from a date onwards
 *
 * Re-running a date replaces its object, so this is safe to schedule and safe to
 * rerun after a backfill.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const store = storeFromEnv();
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const db = openDatabase(dbPath);
db.exec("PRAGMA busy_timeout = 60000;");
const repos = createRepositories(db);

const from = flag("from");
const all = repos.events.serviceDates();
const serviceDates = from ? all.filter((date) => date >= from) : all;

if (serviceDates.length === 0) {
  consoleLogger.warn("nothing to export", { dbPath, from });
  process.exit(0);
}

// Shares the archive lock with the snapshot copy: both walk the same database on
// a machine with little headroom, and neither gains from running beside the other.
await withLock(`${dbPath}.archive.lock`, () =>
  exportEvents({ repos, store, serviceDates, log: consoleLogger }),
);
db.close();
