import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { storeFromEnv } from "../archive/object-store";
import { withLock } from "../archive/run-lock";
import { importPredictions } from "./import-predictions";
import { importScorecards } from "./import-scorecards";

/**
 * CLI: land model predictions and scorecards from object storage into SQLite. Safe
 * to rerun — a day already imported is replaced by whatever was published last.
 *
 * Both datasets, one command: the same model run writes them, so importing one
 * without the other leaves the forecast and its track record disagreeing.
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
const dates = date ? { serviceDates: [date] } : {};
const { predictions, scorecards } = await withLock(`${dbPath}.predictions.lock`, async () => {
  const repos = createRepositories(db);
  return {
    predictions: await importPredictions({ repos, store, ...dates, log: consoleLogger }),
    scorecards: await importScorecards({ repos, store, ...dates, log: consoleLogger }),
  };
});
db.close();

if (predictions.length === 0) consoleLogger.info("no predictions published yet");
if (scorecards.length === 0) consoleLogger.info("no scorecards published yet");
