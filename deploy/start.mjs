// Container supervisor: runs the read-only API always, and the ingest pipeline
// only once GTFS-RT is configured (NJT_TRIP_UPDATES_URL set). Both processes
// share one SQLite file on the mounted volume (WAL = concurrent reader+writer).
// If either child exits, we tear down so the platform restarts the machine.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.NJT_DB_PATH ?? "/data/njt.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
}

function run(script) {
  const child = spawn("npm", ["run", script], { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    console.log(`[supervisor] "${script}" exited (code=${code} signal=${signal})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

run("api");
if (process.env.NJT_TRIP_UPDATES_URL) {
  run("pipeline");
  console.log("[supervisor] API + pipeline started.");
} else {
  console.log("[supervisor] API started. Pipeline disabled — set NJT_TRIP_UPDATES_URL (and the GTFS-RT key) to enable live collection.");
}
