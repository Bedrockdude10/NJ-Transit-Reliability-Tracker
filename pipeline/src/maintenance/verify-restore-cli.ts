import { spawn } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { consoleLogger } from "@njt/shared/logger";
import { RestoreVerificationError, verifyRestore } from "./verify-restore";

/**
 * CLI: prove the replica can actually be restored.
 *
 *   npm run verify:restore
 *   npm run verify:restore -- --tolerance 0.05
 *
 * Read-only with respect to the live database, and safe to run while the
 * pipeline is polling: it restores to a scratch path, compares, and deletes it.
 *
 * Worth running on a schedule rather than once. Replication that worked the day
 * it was switched on can stop silently — expired credentials, a deleted bucket,
 * a machine redeployed onto an image without the binary — and the log line says
 * the same thing either way.
 */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const config = process.env.NJT_LITESTREAM_CONFIG ?? "deploy/litestream.yml";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Set NJT_DB_PATH, or run it on the server (see DEPLOY.md).`);
  process.exit(1);
}

/**
 * `litestream restore` into the scratch path.
 *
 * A non-zero exit is not thrown on directly: an empty replica exits non-zero
 * with a message, and so does a broken one, and the difference matters. The
 * verifier decides, from whether a usable database appeared.
 */
function litestreamRestore(scratchPath: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "litestream",
      ["restore", "-config", config, "-o", scratchPath, dbPath],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", (error) => {
      consoleLogger.error("could not run litestream", { error: error.message });
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) consoleLogger.warn("litestream restore exited non-zero", { code });
      resolve();
    });
  });
}

try {
  const result = await verifyRestore({
    dbPath,
    scratchPath: `${dbPath}.restore-check`,
    restore: litestreamRestore,
    tolerance: Number(flag("tolerance") ?? 0.01),
    freeBytes: (path) => {
      // The scratch file does not exist yet; ask about the directory it lands in.
      const fs = statfsSync(path.slice(0, path.lastIndexOf("/")) || ".");
      return Number(fs.bavail) * Number(fs.bsize);
    },
    log: (message, meta) => consoleLogger.info(message, meta),
  });

  console.log(`\nRestored ${Math.round(result.restoredBytes / 1e6)} MB, integrity ${result.integrity}.`);
  for (const table of result.tables) {
    const lag = table.behind > 0 ? ` (${table.behind} behind)` : "";
    console.log(`  ${table.table.padEnd(24)} ${table.restored}/${table.live}${lag}`);
  }
  console.log("\nThe off-site copy is restorable.");
} catch (error) {
  if (error instanceof RestoreVerificationError) {
    console.error(`\nRESTORE VERIFICATION FAILED: ${error.message}`);
    console.error("There is no proven off-site copy of this database. See DEPLOY.md → Backups.");
    process.exit(1);
  }
  throw error;
}
