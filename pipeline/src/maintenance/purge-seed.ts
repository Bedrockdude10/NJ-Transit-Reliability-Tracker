import { existsSync } from "node:fs";
import { createRepositories, openDatabase } from "@njt/db";
import { purgeSeedData } from "./purge-seed-data";

/**
 * CLI: delete the pre-API seed's fabricated events and re-anchor the collection
 * window. Destructive, so it previews by default — pass `--apply` to write.
 *
 *   npm run purge:seed              # preview
 *   npm run purge:seed -- --apply   # do it
 */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const apply = process.argv.includes("--apply");

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Set NJT_DB_PATH, or run it on the server (see DEPLOY.md).`);
  process.exit(1);
}

const db = openDatabase(dbPath);
// Runs against a live database while the pipeline keeps polling: wait for the
// lock rather than failing, and pause between days so polls get a turn.
db.exec("PRAGMA busy_timeout = 60000;");

const PAUSE_MS = Number(process.env.NJT_PURGE_PAUSE_MS ?? 250);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const repos = createRepositories(db);
const result = purgeSeedData(repos, { dryRun: !apply, betweenDates: () => sleep(PAUSE_MS) });

if (result.eventsDeleted === 0) {
  console.log("No fabricated seed events found — nothing to purge.");
} else {
  const verb = result.dryRun ? "Would delete" : "Deleted";
  console.log(`${verb} ${result.eventsDeleted} fabricated events across ${result.serviceDatesRecomputed.length} service dates`);
  console.log(`  ${result.serviceDatesRecomputed[0]} .. ${result.serviceDatesRecomputed.at(-1)}`);
  console.log(`  collection start: ${result.collectionStartBefore} -> ${result.collectionStartAfter}`);
  if (!result.dryRun) console.log(`  dropped ${result.gapsDropped} gap(s) preceding the new window`);
  if (result.dryRun) console.log("\nPreview only. Re-run with --apply to write.");
}
