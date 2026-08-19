import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { createClient, storeFromEnv } from "../archive/object-store";
import { withLock } from "../archive/run-lock";
import { importPredictions } from "./import-predictions";
import { importScorecards } from "./import-scorecards";
import { s3Reader } from "./object-reader";

/**
 * CLI: land model predictions and scorecards from object storage into SQLite. Safe
 * to rerun — a day already imported is replaced by whatever was published last.
 *
 *   npm run import:predictions                    # everything published
 *   npm run import:predictions -- --date 2026-08-14
 *
 * The repeating path is `archive:worker`; this is the one-shot, for backfills.
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

// Held across passes so a resident loop pays SQLite, the S3 client and Node's own
// startup once. The ETag maps are per dataset: the two share a bucket, not keys.
const repos = createRepositories(db);
const reader = s3Reader(store, createClient(store));
const knownPredictions = new Map<string, string>();
const knownScorecards = new Map<string, string>();

async function pass(): Promise<void> {
  const { predictions, scorecards } = await withLock(`${dbPath}.predictions.lock`, async () => ({
    predictions: await importPredictions({
      repos,
      store,
      reader,
      ...dates,
      log: consoleLogger,
      knownEtags: knownPredictions,
    }),
    scorecards: await importScorecards({
      repos,
      store,
      reader,
      ...dates,
      log: consoleLogger,
      knownEtags: knownScorecards,
    }),
  }));

  if (predictions.length === 0) consoleLogger.info("no predictions published yet");
  if (scorecards.length === 0) consoleLogger.info("no scorecards published yet");
}

await pass();
db.close();
