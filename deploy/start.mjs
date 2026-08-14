// Container supervisor: runs the read-only API always, and the ingest pipeline
// only once GTFS-RT is configured (NJT_RAIL_DATA_USERNAME set). Both processes
// share one SQLite file on the mounted volume (WAL = concurrent reader+writer).
//
// A child that dies is restarted; only a child that will not stay up takes the
// machine down. This used to tear everything down on any exit, which is what
// turned both of this month's incidents into full outages rather than partial
// ones: the pipeline died on an unguarded write inside an error handler, and
// separately lost a migration lock at boot, and each time it took the API — and
// so the whole site — with it. Nothing about either failure involved the API.
//
// The two processes cannot simply be split into separate Fly machines, which
// would be the usual answer: a Fly volume attaches to exactly one machine, and
// they share a SQLite file on it. The coupling is a consequence of the storage
// choice, so the supervisor has to be the thing that limits the damage.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RESTART_WINDOW_MS, decideRestart } from "./restart-policy.mjs";

const dbPath = process.env.NJT_DB_PATH ?? "/data/njt.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

/** @type {Map<string, {child: import('node:child_process').ChildProcess | null, failures: number[]}>} */
const supervised = new Map();
let shuttingDown = false;

function log(message, meta) {
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), source: "supervisor", message, ...meta }));
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const entry of supervised.values()) entry.child?.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
}

function start(script) {
  const entry = supervised.get(script) ?? { child: null, failures: [] };
  supervised.set(script, entry);

  const child = spawn("npm", ["run", script], { stdio: "inherit", env: process.env });
  entry.child = child;

  child.on("exit", (code, signal) => {
    entry.child = null;
    if (shuttingDown) return;

    const decision = decideRestart({ code, failures: entry.failures, now: Date.now() });
    entry.failures = decision.failures;

    if (decision.action === "ignore") {
      log("child exited cleanly; not restarting", { script });
      return;
    }

    if (decision.action === "escalate") {
      log("child keeps failing; giving up so the platform replaces the machine", {
        script,
        failures: decision.failures.length,
        windowMinutes: RESTART_WINDOW_MS / 60_000,
      });
      shutdown(code ?? 1);
      return;
    }

    log("child died; restarting", {
      script,
      code,
      signal,
      failures: decision.failures.length,
      delayMs: decision.delayMs,
    });
    // Deliberately *not* unref'd: while a restart is pending this timer is the
    // only handle keeping the process alive, and an unref'd one let Node exit
    // before it fired — the supervisor logged "restarting" and then died.
    setTimeout(() => {
      if (!shuttingDown) start(script);
    }, decision.delayMs);
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

start("api");
if (process.env.NJT_RAIL_DATA_USERNAME) {
  start("pipeline");
  log("API + pipeline started");
} else {
  log("API started; pipeline disabled — set NJT_RAIL_DATA_USERNAME/PASSWORD to enable live collection");
}
