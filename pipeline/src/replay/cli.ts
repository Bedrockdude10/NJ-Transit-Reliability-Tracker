import { existsSync } from "node:fs";
import { createRepositories, openDatabase } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { replayRange, totalsOf } from "./replay";

/** CLI: re-derive measurement from the raw GTFS-RT archive. Previews unless `--apply`. */
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
// Runs against a live database while the pipeline polls: wait for the lock rather
// than failing, and pause between days so polls get a turn.
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

const sampleLimit = Number(arg("sample") ?? 8);
const fieldTally = new Map<string, number>();
let shown = 0;

const result = replayRange(repos, from, to, {
  apply,
  onDifference: (d) => {
    for (const f of d.fields) fieldTally.set(f.field, (fieldTally.get(f.field) ?? 0) + 1);
    if (shown++ >= sampleLimit) return;
    const summary = d.fields.map((f) => `${f.field}: ${JSON.stringify(f.stored)} -> ${JSON.stringify(f.derived)}`).join(", ");
    console.log(`      trip ${d.tripId} @ ${d.stopId}  ${summary}`);
  },
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

if (fieldTally.size > 0) {
  console.log("\nfields that would change:");
  for (const [field, count] of [...fieldTally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${field.padEnd(20)} ${count.toLocaleString()}`);
  }
}

if (!apply) {
  console.log("\nPreview only. Re-run with --apply to write.");
} else {
  console.log("\nWritten, and affected days recomputed.");
}
