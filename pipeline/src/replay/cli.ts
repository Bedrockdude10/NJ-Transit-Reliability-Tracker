import { existsSync } from "node:fs";
import { createRepositories, openDatabase } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { replayRange, totalsOf } from "./replay";

/**
 * CLI: re-derive measurement from the raw GTFS-Realtime archive.
 *
 *   npm run replay                                    # preview every stored day
 *   npm run replay -- --from 2026-08-01 --to 2026-08-05
 *   npm run replay -- --from 2026-08-01 --apply       # write
 *
 * Previews by default. A replay rewrites measurement, so it should be read
 * before it is trusted.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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
const repos = createRepositories(db);

const extent = repos.snapshots.extent("TripUpdates");
if (!extent) {
  console.error("No TripUpdates snapshots archived — nothing to replay.");
  process.exit(1);
}

const from = arg("from") ?? toLocalDateString(Math.floor(extent.firstMs / 1000));
const to = arg("to") ?? toLocalDateString(Math.floor(extent.lastMs / 1000));
const pauseMs = Number(process.env.NJT_REPLAY_PAUSE_MS ?? 250);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

console.log(
  `${apply ? "Replaying" : "Previewing replay of"} ${from} .. ${to} from ${repos.snapshots.count("TripUpdates").toLocaleString()} archived TripUpdates polls\n`,
);

const result = replayRange(repos, from, to, {
  apply,
  betweenDates: (d) => {
    const diff = d.changed + d.added;
    console.log(
      `  ${d.serviceDate}  ${String(d.snapshotsDecoded).padStart(5)} polls → ${String(d.eventsDerived).padStart(6)} events` +
        `   same ${d.unchanged}` +
        (diff > 0 ? `   changed ${d.changed}   added ${d.added}` : "") +
        (d.orphaned > 0 ? `   orphaned ${d.orphaned}` : ""),
    );
    sleep(pauseMs);
  },
});

const t = totalsOf(result);
console.log(
  `\n${t.snapshotsDecoded.toLocaleString()} polls decoded → ${t.eventsDerived.toLocaleString()} events across ${result.dates.length} days`,
);
console.log(`  reproduced exactly : ${t.unchanged.toLocaleString()}`);
console.log(`  would change       : ${t.changed.toLocaleString()}`);
console.log(`  not currently held : ${t.added.toLocaleString()}`);
console.log(`  stored but not re-derived : ${t.orphaned.toLocaleString()} (left untouched)`);

if (!apply) {
  console.log("\nPreview only. Re-run with --apply to write.");
} else {
  console.log("\nWritten, and affected days recomputed.");
}
