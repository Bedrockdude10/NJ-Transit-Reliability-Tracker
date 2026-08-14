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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

/**
 * @param {string} name label used for logging and failure accounting
 * @param {[string, string[]]} [command] defaults to `npm run <name>`
 */
function start(name, command) {
  const entry = supervised.get(name) ?? { child: null, failures: [] };
  supervised.set(name, entry);

  const [bin, args] = command ?? ["npm", ["run", name]];
  const child = spawn(bin, args, { stdio: "inherit", env: process.env });
  entry.child = child;

  child.on("exit", (code, signal) => {
    entry.child = null;
    if (shuttingDown) return;

    const decision = decideRestart({ code, failures: entry.failures, now: Date.now() });
    entry.failures = decision.failures;

    if (decision.action === "ignore") {
      log("child exited cleanly; not restarting", { script: name });
      return;
    }

    if (decision.action === "escalate") {
      log("child keeps failing; giving up so the platform replaces the machine", {
        script: name,
        failures: decision.failures.length,
        windowMinutes: RESTART_WINDOW_MS / 60_000,
      });
      shutdown(code ?? 1);
      return;
    }

    log("child died; restarting", {
      script: name,
      code,
      signal,
      failures: decision.failures.length,
      delayMs: decision.delayMs,
    });
    // Deliberately *not* unref'd: while a restart is pending this timer is the
    // only handle keeping the process alive, and an unref'd one let Node exit
    // before it fired — the supervisor logged "restarting" and then died.
    setTimeout(() => {
      if (!shuttingDown) start(name, command);
    }, decision.delayMs);
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

const REPLICATION_CONFIGURED = Boolean(process.env.LITESTREAM_BUCKET && process.env.LITESTREAM_ACCESS_KEY_ID);
const LITESTREAM_CONFIG = "deploy/litestream.yml";

/**
 * On an empty volume, pull the database back from the replica before anything
 * opens it.
 *
 * This is the half of a backup that people discover they never had. Replicating
 * is easy to verify; restoring is what actually matters, and it has to happen
 * before the API runs a migration against a blank file and starts serving zeroes
 * over the top of recoverable history.
 *
 * Synchronous and blocking on purpose. A missing replica is not an error — a
 * genuinely first deploy has nothing to restore — so it logs and continues.
 */
function restoreIfMissing() {
  if (!REPLICATION_CONFIGURED || existsSync(dbPath)) return;

  log("no database on the volume; attempting restore from replica", { dbPath });
  const result = spawnSync("litestream", ["restore", "-config", LITESTREAM_CONFIG, dbPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status === 0 && existsSync(dbPath)) log("restored database from replica", { dbPath });
  else log("nothing to restore; starting with an empty database", { status: result.status });
}

restoreIfMissing();

start("api");
if (process.env.NJT_RAIL_DATA_USERNAME) {
  start("pipeline");
} else {
  log("pipeline disabled — set NJT_RAIL_DATA_USERNAME/PASSWORD to enable live collection");
}
if (REPLICATION_CONFIGURED) {
  start("litestream", ["litestream", ["replicate", "-config", LITESTREAM_CONFIG]]);
} else {
  log("replication disabled — set LITESTREAM_BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT to enable");
}
log("supervisor ready", {
  pipeline: Boolean(process.env.NJT_RAIL_DATA_USERNAME),
  replication: REPLICATION_CONFIGURED,
});
