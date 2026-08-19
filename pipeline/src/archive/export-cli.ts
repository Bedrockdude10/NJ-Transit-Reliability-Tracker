import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { datesToExport, exportEvents } from "./export-events";
import { storeFromEnv } from "./object-store";
import { withLock } from "./run-lock";

/**
 * CLI: publish derived events to object storage for the modelling repo.
 *
 *   npm run export:events                      # every service date
 *   npm run export:events -- --from 2026-08-01 # from a date onwards
 *   npm run export:events -- --recent 2        # the newest two, for a frequent run
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

const recent = flag("recent");
const serviceDates = datesToExport(repos.events.serviceDates(), {
  from: flag("from"),
  recent: recent === undefined ? undefined : Number(recent),
});

if (serviceDates.length === 0) {
  consoleLogger.warn("nothing to export", { dbPath });
  process.exit(0);
}

// A separate lock from the snapshot copy's, which touches a different table — see
// run-lock.ts.
await withLock(`${dbPath}.events.lock`, () =>
  exportEvents({ repos, store, serviceDates, log: consoleLogger }),
);
db.close();
