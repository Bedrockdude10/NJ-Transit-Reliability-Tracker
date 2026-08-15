import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { copySnapshots } from "./copy-snapshots";
import { storeFromEnv } from "./object-store";
import { withLock } from "./run-lock";

/**
 * CLI: move raw snapshots out of SQLite and into object storage.
 *
 *   npm run archive:copy                          # hours older than 48
 *   npm run archive:copy -- --older-than-hours 168 --max-hours 24
 *   npm run archive:copy -- --keep                # upload, delete nothing
 *
 * Whole closed hours only, each object verified by the store against its
 * `Content-MD5` before anything is deleted. Safe to rerun: an hour already copied
 * has no rows left to find.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const store = storeFromEnv();

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const db = openDatabase(dbPath);
// Runs against a live database the pipeline is writing to: wait for the lock
// rather than failing.
db.exec("PRAGMA busy_timeout = 60000;");

// One copy at a time: a scheduled run and a manual one overlapped in production,
// and the second counted rows the first was deleting. Named for `raw_snapshots`
// rather than for the archive as a whole, so the events export — which reads a
// different table — is not made to wait behind a backlog drain.
const copied = await withLock(`${dbPath}.snapshots.lock`, () =>
  copySnapshots({
    repos: createRepositories(db),
    store,
    olderThanHours: Number(flag("older-than-hours") ?? process.env.NJT_ARCHIVE_RETAIN_HOURS ?? 48),
    maxHours: flag("max-hours") ? Number(flag("max-hours")) : undefined,
    deleteAfterCopy: !process.argv.includes("--keep"),
    log: consoleLogger,
  }),
);
db.close();

if (copied.length === 0) consoleLogger.info("nothing eligible to copy");
