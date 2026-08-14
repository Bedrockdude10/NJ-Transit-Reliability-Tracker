import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import { copySnapshots } from "./copy-snapshots";
import { withLock } from "./run-lock";
import type { ObjectStore } from "./export-events";

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
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See the Backups section of DEPLOY.md.`);
    process.exit(1);
  }
  return value;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const endpoint = required("NJT_R2_ENDPOINT");
const store: ObjectStore = {
  bucket: required("NJT_R2_BUCKET"),
  endpoint: endpoint.replace(/^https?:\/\//, ""),
  accessKeyId: required("NJT_R2_ACCESS_KEY_ID"),
  secretAccessKey: required("NJT_R2_SECRET_ACCESS_KEY"),
  region: process.env.NJT_R2_REGION ?? "auto",
  useSsl: !endpoint.startsWith("http://"),
};

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const db = openDatabase(dbPath);
// Runs against a live database the pipeline is writing to: wait for the lock
// rather than failing.
db.exec("PRAGMA busy_timeout = 60000;");

// One run at a time. A scheduled run and a manual one overlapped in production:
// the second counted rows the first was deleting and, correctly, refused to
// delete an hour it could only partly account for.
const copied = await withLock(`${dbPath}.copy.lock`, () =>
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
