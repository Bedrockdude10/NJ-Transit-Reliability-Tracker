// Container supervisor. See DEPLOY.md.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RESTART_WINDOW_MS, decideRestart } from "./restart-policy.mjs";
import { decidePipeline, maintenanceFlagPath, stopProcessTree } from "./maintenance.mjs";

const dbPath = process.env.NJT_DB_PATH ?? "/data/njt.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

/** @type {Map<string, {child: import('node:child_process').ChildProcess | null, failures: number[]}>} */
const supervised = new Map();
let shuttingDown = false;

function log(message, meta) {
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), source: "supervisor", message, ...meta }));
}

/** Stop a child and everything it spawned. */
function stopTree(name, entry) {
  stopProcessTree(entry?.child?.pid, {
    log: (message, meta) => log(message, { script: name, ...meta }),
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, entry] of supervised) stopTree(name, entry);
  setTimeout(() => process.exit(code), 3000).unref();
}

/** @param {[string, string[]]} [command] defaults to `npm run <name>` */
function start(name, command) {
  const entry = supervised.get(name) ?? { child: null, failures: [] };
  supervised.set(name, entry);

  const [bin, args] = command ?? ["npm", ["run", name]];
  // `detached` so the child leads its own process group and `stopTree` can signal
  // the whole tree (see `stopProcessTree`). Not unref'd — still owned here.
  const child = spawn(bin, args, { stdio: "inherit", env: process.env, detached: true });
  entry.child = child;

  // A spawn that fails outright (missing binary) emits "error" and never "exit";
  // unhandled it throws and takes the supervisor down with it.
  child.on("error", (error) => {
    log("child failed to start", { script: name, error: error.message });
    if (!child.killed) child.emit("exit", 1, null);
  });

  child.on("exit", (code, signal) => {
    entry.child = null;
    if (shuttingDown) return;

    // The reconcile loop owns restarting a paused pipeline; restarting here would
    // undo the pause a second after it took effect.
    if (name === "pipeline" && maintenancePaused()) {
      log("pipeline stopped for maintenance; will restart when the flag clears", {
        flag: MAINTENANCE_FLAG,
      });
      return;
    }

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
    // only handle keeping the process alive, so unref'd Node exits before it fires.
    setTimeout(() => {
      if (!shuttingDown) start(name, command);
    }, decision.delayMs);
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

/** The pipeline is paused while this file exists. See deploy/maintenance.mjs. */
const MAINTENANCE_FLAG = maintenanceFlagPath(dbPath);
const MAINTENANCE_POLL_MS = 5_000;

function maintenancePaused() {
  return existsSync(MAINTENANCE_FLAG);
}

function reconcileMaintenance() {
  if (shuttingDown || !process.env.NJT_RAIL_DATA_USERNAME) return;

  const entry = supervised.get("pipeline");
  const action = decidePipeline({
    flagPresent: maintenancePaused(),
    running: Boolean(entry?.child),
  });

  if (action === "stop") {
    log("maintenance flag present; pausing ingest", { flag: MAINTENANCE_FLAG });
    stopTree("pipeline", entry);
  } else if (action === "start") {
    log("maintenance flag cleared; resuming ingest");
    // Clear failures: counting deliberate stops toward the crash-loop budget
    // would let two maintenance windows escalate into a machine replace.
    if (entry) entry.failures = [];
    start("pipeline");
  }
}

const COPY_INTERVAL_MS = 60 * 60 * 1000;

/** Built by the Dockerfile; absent in a plain checkout. */
const COPY_BUNDLE = "dist/archive-copy.mjs";
const EXPORT_BUNDLE = "dist/events-export.mjs";
const PREDICTIONS_BUNDLE = "dist/predictions-import.mjs";

/**
 * Matched to the TripUpdates poll, which is the rate at which SQLite learns
 * anything: live scoring needs today's partition while it is still being written,
 * so publishing it partial is now the point rather than the hazard. The consumer
 * is what must not *train* on a day still in progress.
 */
const EXPORT_EVERY_SECONDS = 30;

/** Today and yesterday. The rest of the archive only changes after a repair. */
const EXPORT_RECENT_DAYS = 2;

/** Leave the last two hours in SQLite — the ones a replay is most likely to want. */
const COPY_RETAIN_HOURS = 2;

/**
 * Hours moved per run. The steady state needs one; the cap bounds how long a
 * backlog drain holds resources on a machine with ~150 MB and one shared core.
 */
const COPY_MAX_HOURS = 48;

/**
 * Credentials being present is deliberately not consent to run the daemon: R2
 * access is also what `archive:copy` needs, and the documented order is drain and
 * compact first, replicate second (DEPLOY.md → Order of operations).
 */
const HAS_R2 = Boolean(process.env.NJT_R2_BUCKET && process.env.NJT_R2_ACCESS_KEY_ID);
const REPLICATION_CONFIGURED = HAS_R2 && process.env.NJT_REPLICATION_ENABLED === "true";
const LITESTREAM_CONFIG = "deploy/litestream.yml";

/**
 * Synchronous and blocking on purpose: it must finish before the API migrates a
 * blank file and starts serving zeroes over the top of recoverable history. A
 * missing replica is not an error — a genuinely first deploy has nothing to restore.
 */
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
if (!process.env.NJT_RAIL_DATA_USERNAME) {
  log("pipeline disabled — set NJT_RAIL_DATA_USERNAME/PASSWORD to enable live collection");
} else if (maintenancePaused()) {
  // Booting into an in-progress maintenance window: the database may be half-replaced.
  log("maintenance flag present at boot; ingest paused", { flag: MAINTENANCE_FLAG });
} else {
  start("pipeline");
}
setInterval(reconcileMaintenance, MAINTENANCE_POLL_MS).unref();
if (REPLICATION_CONFIGURED && !hasLitestream()) {
  // Almost always secrets set before deploying. Degrade loudly: taking the site
  // down would not restore the backup.
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
/** Run the archive copy on a timer, never two at once. */
function scheduleArchiveCopy() {
  let running = false;
  const run = () => {
    if (running || shuttingDown) return;
    running = true;
    // The precompiled bundle, not `npm run archive:copy`: that would add an npm
    // process and tsx's compiler to a machine with ~173 MB to spare.
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

/**
 * One resident process that repeats, not one process per tick: at this cadence a
 * fresh Node start would cost ~90 MB and a SQLite open 2,880 times a day on a
 * 512 MB machine. `start` supervises it, so a crash is still restarted.
 */
function scheduleEventsExport() {
  const args = ["--recent", String(EXPORT_RECENT_DAYS), "--every", String(EXPORT_EVERY_SECONDS)];
  const command = existsSync(EXPORT_BUNDLE)
    ? ["node", [EXPORT_BUNDLE, ...args]]
    : ["npm", ["run", "export:events", "--", ...args]];

  // Offset from the copy's first run so the two do not contend at boot.
  setTimeout(() => {
    if (!shuttingDown) start("events-export", command);
  }, 15 * 60 * 1000).unref();

  log("events export scheduled", {
    everySeconds: EXPORT_EVERY_SECONDS,
    recentDays: EXPORT_RECENT_DAYS,
  });
}

/**
 * Matched to the export, so the two ends of the round trip are the same age. A pass
 * is one listing per dataset and downloads only the partitions whose ETag moved, so
 * the steady cost is two requests rather than the whole published archive.
 */
const IMPORT_EVERY_SECONDS = 30;

function schedulePredictionImport() {
  const args = ["--every", String(IMPORT_EVERY_SECONDS)];
  const command = existsSync(PREDICTIONS_BUNDLE)
    ? ["node", [PREDICTIONS_BUNDLE, ...args]]
    : ["npm", ["run", "import:predictions", "--", ...args]];

  // Offset from the export's first run so the two do not contend at boot.
  setTimeout(() => {
    if (!shuttingDown) start("predictions-import", command);
  }, 10 * 60 * 1000).unref();

  log("prediction import scheduled", { everySeconds: IMPORT_EVERY_SECONDS });
}

if (HAS_R2 && process.env.NJT_EVENTS_EXPORT_ENABLED === "true") {
  scheduleEventsExport();
}

if (HAS_R2 && process.env.NJT_PREDICTION_IMPORT_ENABLED === "true") {
  schedulePredictionImport();
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
  eventsExport: HAS_R2 && process.env.NJT_EVENTS_EXPORT_ENABLED === "true",
  predictionImport: HAS_R2 && process.env.NJT_PREDICTION_IMPORT_ENABLED === "true",
});
