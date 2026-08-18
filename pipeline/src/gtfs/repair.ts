import { existsSync } from "node:fs";
import { createRepositories, openDatabase } from "@njt/db";
import { repairLineNames } from "./repair-line-names";

/** CLI: repair events stored under a raw feed route_id instead of a line name. */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";

// Must never create a database: repairing a fresh empty file silently "succeeds"
// while the real one goes untouched.
if (!existsSync(dbPath)) {
  console.error(
    `No database at ${dbPath}.\n` +
      "This repair runs against an existing collection — set NJT_DB_PATH, or run it\n" +
      "on the server where the pipeline writes (see DEPLOY.md).",
  );
  process.exit(1);
}

const db = openDatabase(dbPath);
// The default 5s busy_timeout is tuned for short writes; a recompute is longer, so
// wait rather than fail — and pause between days so the live pipeline gets a turn.
db.exec("PRAGMA busy_timeout = 60000;");

const PAUSE_MS = Number(process.env.NJT_REPAIR_PAUSE_MS ?? 250);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const repos = createRepositories(db);
const result = repairLineNames(repos, { betweenDates: () => sleep(PAUSE_MS) });

if (result.aliasesBackfilled > 0) {
  console.log(`Backfilled ${result.aliasesBackfilled} route aliases from the archived routes.txt.`);
}
if (result.relabelled.length === 0) {
  console.log("No events stored under a raw route id — nothing to repair.");
} else {
  for (const r of result.relabelled) {
    console.log(`  "${r.from}" -> ${r.routeId} / "${r.to}" (${r.events} events)`);
  }
  console.log(`Recomputed aggregates for ${result.serviceDatesRecomputed.length} service dates.`);
}
