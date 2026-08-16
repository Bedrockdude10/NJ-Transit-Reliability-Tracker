import { existsSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { consoleLogger } from "@njt/shared/logger";
import { maintenanceFlagPath } from "../../../deploy/maintenance.mjs";
import { compactDatabase, inspect } from "./compact";

/**
 * CLI: reclaim the disk the archive drain freed inside the database.
 *
 *   npm run compact                     # report what it would reclaim, change nothing
 *   npm run compact -- --apply          # pause ingest, copy, verify, swap, resume
 *   npm run compact -- --apply --quiesce-seconds 30
 *
 * Preview by default, like `replay` and `purge:seed`: this replaces the live
 * database, and the first thing anyone should see is the size of the change.
 *
 * `--apply` pauses ingest for the duration by creating the maintenance flag the
 * supervisor watches, and clears it afterwards — including when the run fails,
 * because a machine left with ingest paused accrues a permanent gap in a feed
 * that serves no history. The API is left running throughout; it only reads.
 *
 * **Restart the API afterwards.** Its open handle still points at the file that
 * was moved aside, so it will happily serve the pre-compaction database until it
 * is restarted. See DEPLOY.md for the sequence.
 */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const apply = process.argv.includes("--apply");

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Set NJT_DB_PATH, or run it on the server (see DEPLOY.md).`);
  process.exit(1);
}

const freeBytes = (path: string) => {
  const fs = statfsSync(path);
  return Number(fs.bavail) * Number(fs.bsize);
};

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

if (!apply) {
  const plan = inspect({ dbPath, freeBytes });
  console.log(`Database        ${dbPath}`);
  console.log(`On disk         ${mb(plan.fileBytes)}`);
  console.log(`Live data       ${mb(plan.liveBytes)}`);
  console.log(`Reclaimable     ${mb(plan.reclaimableBytes)}`);
  console.log(`Volume free     ${mb(plan.freeBytes)} (needs ${mb(plan.requiredBytes)})`);
  console.log(`Raw snapshots   ${plan.rawSnapshots} still to drain`);
  console.log("\nPreview only. Re-run with --apply to pause ingest and swap in the compacted copy.");
  process.exit(0);
}

const flagPath = maintenanceFlagPath(dbPath);
writeFileSync(flagPath, `compacting since ${new Date().toISOString()}\n`);
consoleLogger.info("ingest paused for compaction", { flag: flagPath });

try {
  const result = await compactDatabase({
    dbPath,
    apply: true,
    freeBytes,
    quiesceMs: Number(flag("quiesce-seconds") ?? 30) * 1000,
    maxRawSnapshots: Number(flag("max-raw-snapshots") ?? 0),
    log: (message, meta) => consoleLogger.info(message, meta),
  });

  console.log(`\nCompacted ${mb(result.fileBytes)} → ${mb(result.compactedBytes)}.`);
  console.log(`Previous database kept at ${result.backupPath}.`);
  console.log("\nNext: restart the API so it reopens the new file, confirm /health and the site,");
  console.log(`then remove the old one:\n  rm ${result.backupPath}*`);
} finally {
  // Always, including on failure. Ingest left paused is a permanent gap in a
  // feed nobody can re-fetch, which is worse than whatever went wrong above.
  rmSync(flagPath, { force: true });
  consoleLogger.info("ingest resumed", { flag: flagPath });
}
