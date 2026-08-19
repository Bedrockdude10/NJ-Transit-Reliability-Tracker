import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { datesToExport, exportEvents } from "./export-events";
import { createClient, storeFromEnv } from "./object-store";
import { withLock } from "./run-lock";

/**
 * CLI: publish derived events to object storage for the modelling repo.
 *
 *   npm run export:events                      # every service date
 *   npm run export:events -- --from 2026-08-01 # from a date onwards
 *   npm run export:events -- --recent 2        # the newest two, for a frequent run
 *   npm run export:events -- --recent 2 --every 30   # stay up and repeat
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
const window = {
  from: flag("from"),
  recent: recent === undefined ? undefined : Number(recent),
};

// Held across passes so a resident loop pays SQLite, the S3 client and Node's own
// startup once instead of on every tick.
const client = createClient(store);
const knownDigests = new Map<string, string>();

/** Resolved per pass, not once: a loop outlives the service date it started in. */
async function pass(): Promise<void> {
  const serviceDates = datesToExport(repos.events.serviceDates(), window);
  if (serviceDates.length === 0) {
    consoleLogger.warn("nothing to export", { dbPath });
    return;
  }
  await withLock(`${dbPath}.events.lock`, () =>
    exportEvents({ repos, store, serviceDates, client, log: consoleLogger, knownDigests }),
  );
}

const everySeconds = Number(flag("every") ?? 0);

if (everySeconds <= 0) {
  await pass();
  db.close();
} else {
  const tick = async (): Promise<void> => {
    try {
      await pass();
    } catch (error) {
      // A pass fails on a held lock or a memory shortfall, both of which the next
      // tick may well clear. Dying would need the supervisor to restart the process.
      consoleLogger.error("export pass failed; retrying next tick", { error: String(error) });
    }
  };

  const interval = setInterval(tick, everySeconds * 1000);
  const stop = (): void => {
    clearInterval(interval);
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  consoleLogger.info("events export resident", { everySeconds, ...window });
  await tick();
}
