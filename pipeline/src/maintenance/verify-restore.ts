import { rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Restore the replica and check it is the database it claims to be.
 *
 * Replication is easy to believe in and hard to trust. `litestream replicate`
 * logs happily whether or not the result is restorable, and the moment anyone
 * finds out is the moment they need it — with the volume already gone. A backup
 * nobody has restored is a hypothesis.
 *
 * So this restores to a scratch path beside the live database, opens it, and
 * compares it against the original: integrity first, then row counts per table,
 * then how far behind the replica is. It never touches the live file, and it
 * deletes the scratch copy when it is done.
 *
 * Lag is expected and reported rather than failed on. Litestream ships the WAL
 * continuously but not synchronously, so a table being written to as this runs
 * is legitimately a few rows short in the replica; a table that is *empty* in
 * the replica and full in the original is not lag, and that is what the
 * threshold distinguishes.
 */

export interface VerifyRestoreOptions {
  /** The live database, as the yardstick. */
  dbPath: string;
  /** Where to restore to. Deleted afterwards. */
  scratchPath: string;
  /** Runs `litestream restore` into the scratch path. Injected in tests. */
  restore: (scratchPath: string) => Promise<void>;
  /**
   * How far behind a table may be and still pass, as a share of its rows.
   *
   * Not zero: the pipeline commits every 30 seconds and replication is
   * asynchronous, so an exact match would fail for reasons that are not faults.
   */
  tolerance?: number;
  freeBytes?: (path: string) => number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface TableComparison {
  table: string;
  live: number;
  restored: number;
  /** Rows the replica is missing. Negative means it has more, which is fine. */
  behind: number;
}

export interface VerifyRestoreResult {
  restoredBytes: number;
  integrity: string;
  tables: TableComparison[];
  /** The worst shortfall found, as a share of that table's rows. */
  worstShortfall: number;
  durationMs: number;
}

export class RestoreVerificationError extends Error {}

function userTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function countRows(db: DatabaseSync, table: string): number {
  const quoted = `"${table.replace(/"/g, '""')}"`;
  return Number((db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get() as { n: number }).n);
}

/**
 * Compare the restored copy against the live database, table by table.
 *
 * Pure, so the judgement is testable without a bucket: what counts as an
 * acceptable shortfall is the part worth arguing about.
 */
export function compareCounts(
  live: ReadonlyMap<string, number>,
  restored: ReadonlyMap<string, number>,
): TableComparison[] {
  return [...live].map(([table, liveCount]) => ({
    table,
    live: liveCount,
    restored: restored.get(table) ?? 0,
    behind: liveCount - (restored.get(table) ?? 0),
  }));
}

/** The largest shortfall as a share of the table's rows; 0 when nothing is behind. */
export function worstShortfall(tables: readonly TableComparison[]): number {
  let worst = 0;
  for (const table of tables) {
    if (table.live === 0 || table.behind <= 0) continue;
    worst = Math.max(worst, table.behind / table.live);
  }
  return worst;
}

export async function verifyRestore(options: VerifyRestoreOptions): Promise<VerifyRestoreResult> {
  const { dbPath, scratchPath } = options;
  const log = options.log ?? (() => {});
  const tolerance = options.tolerance ?? 0.01;
  const startedAt = Date.now();

  const liveBytes = statSync(dbPath).size;
  const free = options.freeBytes?.(scratchPath) ?? Number.POSITIVE_INFINITY;
  if (free < liveBytes * 1.2) {
    throw new RestoreVerificationError(
      `not enough room to restore beside the live database: need ~${Math.round((liveBytes * 1.2) / 1e6)}MB, have ${Math.round(free / 1e6)}MB`,
    );
  }

  // A leftover from an interrupted run would otherwise be mistaken for a fresh
  // restore, and pass.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${scratchPath}${suffix}`, { force: true });

  try {
    log("restoring from the replica", { to: scratchPath });
    await options.restore(scratchPath);

    let restoredBytes: number;
    try {
      restoredBytes = statSync(scratchPath).size;
    } catch {
      throw new RestoreVerificationError(
        "the restore produced no database. There is no off-site copy — treat this as an outage of the backup, not a warning.",
      );
    }

    const restored = new DatabaseSync(scratchPath, { readOnly: true });
    const live = new DatabaseSync(dbPath, { readOnly: true });
    let result: VerifyRestoreResult;
    try {
      const row = restored.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
      const integrity = String(Object.values(row)[0]);
      if (integrity !== "ok") {
        throw new RestoreVerificationError(`the restored database failed integrity_check: ${integrity}`);
      }

      const tables = userTables(live);
      const comparisons = compareCounts(
        new Map(tables.map((table) => [table, countRows(live, table)])),
        new Map(
          userTables(restored)
            .filter((table) => tables.includes(table))
            .map((table) => [table, countRows(restored, table)]),
        ),
      );

      const missing = comparisons.filter((c) => c.restored === 0 && c.live > 0).map((c) => c.table);
      if (missing.length > 0) {
        throw new RestoreVerificationError(
          `the restored database is missing every row of: ${missing.join(", ")}. This is not replication lag.`,
        );
      }

      const worst = worstShortfall(comparisons);
      if (worst > tolerance) {
        const behind = comparisons.filter((c) => c.behind > 0);
        throw new RestoreVerificationError(
          `the replica is ${(worst * 100).toFixed(1)}% behind, past the ${(tolerance * 100).toFixed(1)}% tolerance: ` +
            behind.map((c) => `${c.table} ${c.restored}/${c.live}`).join(", "),
        );
      }

      result = {
        restoredBytes,
        integrity,
        tables: comparisons,
        worstShortfall: worst,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      restored.close();
      live.close();
    }

    log("restore verified", {
      restoredMB: Math.round(result.restoredBytes / 1e6),
      tables: result.tables.length,
      worstShortfallPercent: Number((result.worstShortfall * 100).toFixed(2)),
      durationMs: result.durationMs,
    });
    return result;
  } finally {
    // The scratch copy is proof, not a backup — leaving it eats the volume that
    // the compaction just cleared.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${scratchPath}${suffix}`, { force: true });
  }
}
