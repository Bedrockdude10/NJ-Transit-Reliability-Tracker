import { createRepositories, openDatabase } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { consoleLogger } from "@njt/shared/logger";
import { importPredictions } from "../predictions/import-predictions";
import { importScorecards } from "../predictions/import-scorecards";
import { s3Reader } from "../predictions/object-reader";
import { datesToExport, exportEvents, PASS_MEMORY_MB } from "./export-events";
import { createClient, storeFromEnv } from "./object-store";
import { runResident } from "./resident";
import { withLock } from "./run-lock";

/**
 * CLI: the container's one resident archive process — publish today's events, then
 * land whatever the modelling repo has published, every `--every` seconds.
 *
 *   npm run archive:worker -- --every 30 --recent 2
 *
 * Both halves in one process because each Node process costs ~90 MB of a 512 MB
 * machine; two of them left the export short of the memory it checks for. The
 * one-shot `export:events` and `import:predictions` remain, for backfills.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const store = storeFromEnv();
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const db = openDatabase(dbPath);
db.exec("PRAGMA busy_timeout = 60000;");

const recent = flag("recent");
const explicitRecent = recent === undefined ? undefined : Number(recent);

const repos = createRepositories(db);
const client = createClient(store);
const reader = s3Reader(store, client);
const knownDigests = new Map<string, string>();
const knownPredictions = new Map<string, string>();
const knownScorecards = new Map<string, string>();

/** Resolved per pass, not once: a resident loop crosses midnight. */
async function exportPass(): Promise<void> {
  const serviceDates = datesToExport(repos.events.serviceDates(), {
    recent: explicitRecent,
    through: toLocalDateString(Date.now() / 1000),
  });
  if (serviceDates.length === 0) return;

  await withLock(`${dbPath}.events.lock`, () =>
    exportEvents({
      repos,
      store,
      serviceDates,
      client,
      log: consoleLogger,
      knownDigests,
      requiredMemoryMb: PASS_MEMORY_MB,
    }),
  );
}

async function importPass(): Promise<void> {
  await withLock(`${dbPath}.predictions.lock`, async () => {
    await importPredictions({
      repos,
      store,
      reader,
      log: consoleLogger,
      knownEtags: knownPredictions,
    });
    await importScorecards({
      repos,
      store,
      reader,
      log: consoleLogger,
      knownEtags: knownScorecards,
    });
  });
}

const everySeconds = Number(flag("every") ?? 30);
consoleLogger.info("archive worker resident", { everySeconds, recent: explicitRecent });

// Export first: publishing today's events is what live scoring is waiting on, and a
// failure in it must not stop predictions already published from landing.
await runResident({
  everySeconds,
  log: consoleLogger,
  close: () => db.close(),
  tick: async () => {
    let failure: unknown;
    try {
      await exportPass();
    } catch (error) {
      failure = error;
    }
    await importPass();
    if (failure !== undefined) throw failure;
  },
});
