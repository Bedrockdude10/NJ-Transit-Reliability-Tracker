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

  // A spawn that fails outright — a missing binary, typically — emits "error"
  // and never "exit". Unhandled, that throws and takes the supervisor with it,
  // which is worse than the thing that failed: the API was serving fine.
  child.on("error", (error) => {
    log("child failed to start", { script: name, error: error.message });
    if (!child.killed) child.emit("exit", 1, null);
  });

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

/**
 * How often to drain the snapshot archive to object storage.
 *
 * Hourly, because the volume fills at 130 MB/day and a copy that runs often is
 * what keeps it flat — the alternative is a large periodic job on a small
 * machine, which is what caused an outage. Each run moves the hours that have
 * closed since the last one, so a missed run costs nothing but a bigger next one.
 */
const COPY_INTERVAL_MS = 60 * 60 * 1000;

/** Built by the Dockerfile; absent in a plain checkout. */
const COPY_BUNDLE = "dist/archive-copy.mjs";

/**
 * Leave the last two hours in SQLite. Recent snapshots are the ones a replay is
 * most likely to want, and the current hour is still being written to.
 */
const COPY_RETAIN_HOURS = 2;

/**
 * Hours moved per run.
 *
 * The steady state needs one. The cap is for the backlog: it bounds how long any
 * single run holds resources on a machine that has ~150 MB and one shared core to
 * spare, so a month of accumulated archive drains over several runs instead of
 * one long one. Well above the steady-state need, so a few missed runs still
 * catch up.
 */
const COPY_MAX_HOURS = 48;

/**
 * Replication needs credentials *and* an explicit opt-in.
 *
 * These were one switch, which was wrong in a way that showed up immediately:
 * the same `NJT_R2_BUCKET` that lets `archive:copy` reach object storage also
 * started Litestream, so there was no way to follow the documented order —
 * shrink the database first, replicate second. Enabling both at once is exactly
 * what starved the API into an outage, replicating 3.8 GB on a 512 MB box.
 *
 * Credentials being present is not consent to run a daemon.
 */
const HAS_R2 = Boolean(process.env.NJT_R2_BUCKET && process.env.NJT_R2_ACCESS_KEY_ID);
const REPLICATION_CONFIGURED = HAS_R2 && process.env.NJT_REPLICATION_ENABLED === "true";
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
/** Whether the litestream binary is available to this container. */
function hasLitestream() {
  return spawnSync("litestream", ["version"], { stdio: "ignore" }).status === 0;
}

function restoreIfMissing() {
  if (!REPLICATION_CONFIGURED || existsSync(dbPath) || !hasLitestream()) return;

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
if (REPLICATION_CONFIGURED && !hasLitestream()) {
  // Replication configured but the binary is not in the image — almost always
  // secrets set before deploying. Losing off-site backup is serious, but taking
  // the site down does not restore it, so this degrades loudly instead.
  log("REPLICATION CONFIGURED BUT litestream IS NOT INSTALLED — no off-site backup", {
    hint: "deploy the current image, which installs it, then this starts on the next boot",
  });
} else if (REPLICATION_CONFIGURED) {
  start("litestream", ["litestream", ["replicate", "-config", LITESTREAM_CONFIG]]);
} else {
  log(
    HAS_R2
      ? "replication off — credentials present; set NJT_REPLICATION_ENABLED=true to start it"
      : "replication off — set NJT_R2_BUCKET/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY, then NJT_REPLICATION_ENABLED=true",
  );
}
/**
 * Run the archive copy on a timer, never two at once.
 *
 * Deliberately not a supervised child: this is a job that finishes, and the
 * restart policy is about processes that are supposed to stay up. A run that
 * fails is logged and retried at the next tick — the copy is idempotent and
 * deletes nothing it has not confirmed, so a failed run leaves the archive
 * intact rather than half-moved.
 *
 * It has to live inside this container: a Fly volume attaches to exactly one
 * machine, so nothing else can read the database.
 */
function scheduleArchiveCopy() {
  let running = false;
  const run = () => {
    if (running || shuttingDown) return;
    running = true;
    // The precompiled bundle, not `npm run archive:copy`: that would add an npm
    // process and tsx's compiler to a machine that has ~173 MB to spare. Falls
    // back to the source when the bundle is absent, so this works in a checkout.
    const [bin, args] = existsSync(COPY_BUNDLE)
      ? ["node", [COPY_BUNDLE]]
      : ["npm", ["run", "archive:copy", "--"]];
    const child = spawn(
      bin,
      [...args, "--older-than-hours", String(COPY_RETAIN_HOURS), "--max-hours", String(COPY_MAX_HOURS)],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("error", (error) => {
      running = false;
      log("archive copy failed to start", { error: error.message });
    });
    child.on("exit", (code) => {
      running = false;
      if (code !== 0) log("archive copy exited non-zero; will retry next tick", { code });
    });
  };

  setInterval(run, COPY_INTERVAL_MS).unref();
  // Not at boot: let the API come up and pass its health check first.
  setTimeout(run, 5 * 60 * 1000).unref();
  log("archive copy scheduled", {
    everyMinutes: COPY_INTERVAL_MS / 60_000,
    retainHours: COPY_RETAIN_HOURS,
    maxHoursPerRun: COPY_MAX_HOURS,
  });
}

if (HAS_R2 && process.env.NJT_ARCHIVE_COPY_ENABLED === "true") {
  scheduleArchiveCopy();
} else if (HAS_R2) {
  log("archive copy off — set NJT_ARCHIVE_COPY_ENABLED=true to drain snapshots hourly");
}

log("supervisor ready", {
  pipeline: Boolean(process.env.NJT_RAIL_DATA_USERNAME),
  objectStorage: HAS_R2,
  replication: REPLICATION_CONFIGURED,
  archiveCopy: HAS_R2 && process.env.NJT_ARCHIVE_COPY_ENABLED === "true",
});
