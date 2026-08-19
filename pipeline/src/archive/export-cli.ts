import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { toLocalDateString } from "@njt/shared";
import { datesToExport, exportEvents } from "./export-events";
import { createClient, storeFromEnv } from "./object-store";
import { withLock } from "./run-lock";

/**
 * CLI: publish derived events to object storage for the modelling repo.
 *
 *   npm run export:events                      # every service date
 *   npm run export:events -- --from 2026-08-01 # from a date onwards
 *   npm run export:events -- --recent 2        # the newest two
 *
 * The repeating path is `archive:worker`; this is the one-shot, for backfills.
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
const from = flag("from");
const explicitRecent = recent === undefined ? undefined : Number(recent);

/**
 * Resolved per pass, not once: `through` is today in NJT's timezone, and a resident
 * loop crosses midnight.
 */
function currentWindow() {
  return { from, recent: explicitRecent, through: toLocalDateString(Date.now() / 1000) };
}

// Held across passes so a resident loop pays SQLite, the S3 client and Node's own
// startup once instead of on every tick.
const client = createClient(store);
const knownDigests = new Map<string, string>();

/** Resolved per pass, not once: a loop outlives the service date it started in. */
async function pass(): Promise<void> {
  const serviceDates = datesToExport(repos.events.serviceDates(), currentWindow());
  if (serviceDates.length === 0) {
    consoleLogger.warn("nothing to export", { dbPath });
    return;
  }
  await withLock(`${dbPath}.events.lock`, () =>
    exportEvents({ repos, store, serviceDates, client, log: consoleLogger, knownDigests }),
  );
}

await pass();
db.close();
