import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger } from "@njt/shared/logger";
import type { ObjectStore } from "./export-events";
import { sweepSnapshots } from "./sweep-snapshots";

/**
 * CLI: drain the raw snapshot archive out of SQLite into object storage.
 *
 *   npm run sweep:archive                             # days older than 2
 *   npm run sweep:archive -- --older-than 7
 *   npm run sweep:archive -- --older-than 7 --max-days 2
 *   npm run sweep:archive -- --memory-limit 48         # tighter box
 *
 * Whole UTC days only, hash-verified before anything is deleted, and no VACUUM —
 * the file stops growing rather than shrinking. Safe to run on a schedule and
 * safe to rerun: a day already swept has nothing left to do.
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
// rather than failing, and yield between delete batches so polls get a turn.
db.exec("PRAGMA busy_timeout = 60000;");
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const swept = await sweepSnapshots({
  dbPath,
  repos: createRepositories(db),
  store,
  olderThanDays: Number(flag("older-than") ?? process.env.NJT_ARCHIVE_RETAIN_DAYS ?? 2),
  maxDays: flag("max-days") ? Number(flag("max-days")) : undefined,
  memoryLimitMb: flag("memory-limit") ? Number(flag("memory-limit")) : undefined,
  betweenBatches: () => sleep(Number(process.env.NJT_SWEEP_PAUSE_MS ?? 100)),
  log: consoleLogger,
});
db.close();

if (swept.length === 0) consoleLogger.info("nothing eligible to sweep");
