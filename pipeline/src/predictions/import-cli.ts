import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { storeFromEnv } from "../archive/object-store";
import { withLock } from "../archive/run-lock";
import { importPredictions } from "./import-predictions";

/**
 * CLI: land model predictions from object storage into SQLite. Safe to rerun — a day
 * already imported is replaced by whatever the modelling repo published last.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const store = storeFromEnv();
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const db = openDatabase(dbPath);
db.exec("PRAGMA busy_timeout = 60000;");

const date = flag("date");
const imported = await withLock(`${dbPath}.predictions.lock`, () =>
  importPredictions({
    repos: createRepositories(db),
    store,
    ...(date ? { serviceDates: [date] } : {}),
    log: consoleLogger,
  }),
);
db.close();

if (imported.length === 0) consoleLogger.info("no predictions published yet");
