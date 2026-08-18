import { existsSync, mkdirSync, statfsSync } from "node:fs";
import { consoleLogger } from "@njt/shared/logger";
import { restoreSnapshot, snapshotDatabase } from "./snapshot";

/**
 * CLI: take a verified, compressed snapshot of the live database.
 *
 *   npm run snapshot                          # write one, keep the last 7
 *   npm run snapshot -- --keep 30
 *   npm run snapshot -- --restore <file.gz> --to <out.sqlite>
 *
 * Safe to run while the pipeline is polling. The snapshot lands next to the database,
 * so on its own it is a restore point, not an off-site backup — see DEPLOY.md.
 */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const outDir = process.env.NJT_SNAPSHOT_DIR ?? "./data/snapshots";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const restoreFrom = flag("restore");
if (restoreFrom) {
  const to = flag("to");
  if (!to) {
    console.error("--restore needs --to <path> for the database to write.");
    process.exit(1);
  }
  await restoreSnapshot(restoreFrom, to);
  consoleLogger.info("snapshot restored", { from: restoreFrom, to });
} else {
  if (!existsSync(dbPath)) {
    console.error(`No database at ${dbPath}. Set NJT_DB_PATH, or run it on the server (see DEPLOY.md).`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const result = await snapshotDatabase({
    dbPath,
    outDir,
    keep: Number(flag("keep") ?? process.env.NJT_SNAPSHOT_KEEP ?? 7),
    freeBytes: (path) => {
      const fs = statfsSync(path);
      return Number(fs.bavail) * Number(fs.bsize);
    },
    log: (message, meta) => consoleLogger.info(message, meta),
  });
  // Printed bare on stdout so a shell can pick it up: `rclone copy "$(npm ...)"`.
  console.log(result.path);
}
