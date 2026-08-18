import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Reclaim the disk the archive drain freed inside the database. See DEPLOY.md.
 *
 * `VACUUM INTO` copies the database as of the instant it starts, so swapping in a
 * copy taken minutes ago silently discards the ingest in between — hence the pause
 * (`deploy/maintenance.mjs`) and the `data_version` proof below.
 */

export interface CompactOptions {
  dbPath: string;
  /** Preview only unless set. Every destructive step is behind this. */
  apply: boolean;
  /**
   * Refuse to run while more than this many raw snapshots remain: compacting
   * mid-drain copies pages the drain is about to free, and the file grows back.
   */
  maxRawSnapshots?: number;
  /** How long to watch for writes before trusting the pause. */
  quiesceMs?: number;
  freeBytes?: (path: string) => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface CompactPlan {
  fileBytes: number;
  /** What the file would occupy with the free pages gone. */
  liveBytes: number;
  reclaimableBytes: number;
  freeBytes: number;
  requiredBytes: number;
  rawSnapshots: number;
}

export interface CompactResult extends CompactPlan {
  /** Where the previous database was kept. Deleted by hand, once proven. */
  backupPath: string;
  compactedBytes: number;
  durationMs: number;
  verifiedTables: number;
}

/**
 * Room needed before starting: both databases exist at once, on purpose, plus a
 * margin for WAL growth. Checked up front because filling this volume takes the live
 * database down with it.
 */
export function requiredBytes(liveBytes: number): number {
  return Math.ceil(liveBytes * 1.1) + 128 * 1024 * 1024;
}

/** Bytes in use versus bytes on the freelist, from SQLite's own accounting. */
export function planFromPragmas(pragmas: {
  pageCount: number;
  pageSize: number;
  freelistCount: number;
}): { fileBytes: number; liveBytes: number; reclaimableBytes: number } {
  const fileBytes = pragmas.pageCount * pragmas.pageSize;
  const reclaimableBytes = pragmas.freelistCount * pragmas.pageSize;
  return { fileBytes, liveBytes: fileBytes - reclaimableBytes, reclaimableBytes };
}

function pragmaNumber(db: DatabaseSync, pragma: string): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  return Number(row ? Object.values(row)[0] : 0);
}

/** User tables, so the row-count comparison needs no list to maintain. */
function userTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function rowCounts(db: DatabaseSync, tables: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    // Quoted so a table called `order` or `group` counts like any other.
    const quoted = `"${table.replace(/"/g, '""')}"`;
    const row = db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get() as { n: number };
    counts.set(table, Number(row.n));
  }
  return counts;
}

function integrityOf(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    return row ? String(Object.values(row)[0]) : "no result";
  } finally {
    db.close();
  }
}

/** Inspect without changing anything. */
export function inspect(options: Pick<CompactOptions, "dbPath" | "freeBytes">): CompactPlan {
  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  try {
    const sizes = planFromPragmas({
      pageCount: pragmaNumber(db, "page_count"),
      pageSize: pragmaNumber(db, "page_size"),
      freelistCount: pragmaNumber(db, "freelist_count"),
    });
    const rawSnapshots = userTables(db).includes("raw_snapshots")
      ? Number((db.prepare("SELECT count(*) AS n FROM raw_snapshots").get() as { n: number }).n)
      : 0;
    return {
      ...sizes,
      rawSnapshots,
      freeBytes: options.freeBytes?.(options.dbPath) ?? Number.POSITIVE_INFINITY,
      requiredBytes: requiredBytes(sizes.liveBytes),
    };
  } finally {
    db.close();
  }
}

export async function compactDatabase(options: CompactOptions): Promise<CompactResult> {
  const { dbPath, apply } = options;
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const quiesceMs = options.quiesceMs ?? 10_000;
  const startedAt = Date.now();

  const plan = inspect(options);
  log("compaction plan", {
    fileMB: Math.round(plan.fileBytes / 1e6),
    liveMB: Math.round(plan.liveBytes / 1e6),
    reclaimableMB: Math.round(plan.reclaimableBytes / 1e6),
    freeMB: Number.isFinite(plan.freeBytes) ? Math.round(plan.freeBytes / 1e6) : null,
    rawSnapshots: plan.rawSnapshots,
  });

  if (plan.freeBytes < plan.requiredBytes) {
    throw new Error(
      `not enough room to compact ${dbPath}: need ~${Math.round(plan.requiredBytes / 1e6)}MB free, have ${Math.round(plan.freeBytes / 1e6)}MB`,
    );
  }

  const maxRawSnapshots = options.maxRawSnapshots ?? 0;
  if (plan.rawSnapshots > maxRawSnapshots) {
    throw new Error(
      `${plan.rawSnapshots} raw snapshots still to drain (limit ${maxRawSnapshots}). ` +
        "Let `archive:copy` finish first, or the pages it is about to free get copied into the new file. " +
        "Pass --max-raw-snapshots to override.",
    );
  }

  const backupPath = `${dbPath}.pre-compact`;
  const workingPath = `${dbPath}.compacting`;

  if (!apply) {
    log("dry run — nothing written", { wouldWrite: workingPath, wouldKeep: backupPath });
    return {
      ...plan,
      backupPath,
      compactedBytes: plan.liveBytes,
      durationMs: Date.now() - startedAt,
      verifiedTables: 0,
    };
  }

  if (existsSync(backupPath)) {
    throw new Error(
      `${backupPath} already exists — a previous compaction has not been cleaned up. ` +
        "Confirm the live database is good, remove it, and re-run.",
    );
  }

  const source = new DatabaseSync(dbPath, { readOnly: true });
  let result: CompactResult;
  try {
    // If ingest is still running the pause did not take.
    const before = pragmaNumber(source, "data_version");
    await sleep(quiesceMs);
    if (pragmaNumber(source, "data_version") !== before) {
      throw new Error(
        "the database is still being written to — ingest is not paused. " +
          "Compacting now would discard everything written between the copy and the swap.",
      );
    }
    log("database is quiet; taking the copy", { quiesceMs });

    rmSync(workingPath, { force: true });
    source.exec(`VACUUM INTO '${workingPath.replace(/'/g, "''")}'`);

    const verdict = integrityOf(workingPath);
    if (verdict !== "ok") throw new Error(`the compacted copy failed integrity_check: ${verdict}`);

    // `integrity_check` proves the copy is a well-formed database; it says nothing
    // about it being a copy of *this* one.
    const tables = userTables(source);
    const expected = rowCounts(source, tables);
    const copy = new DatabaseSync(workingPath, { readOnly: true });
    try {
      const actual = rowCounts(copy, tables);
      for (const [table, count] of expected) {
        if (actual.get(table) !== count) {
          throw new Error(
            `the compacted copy lost rows in ${table}: ${count} before, ${actual.get(table) ?? 0} after`,
          );
        }
      }
    } finally {
      copy.close();
    }

    // SQLite bumps `data_version` in this connection whenever another commits, so an
    // unchanged value proves the copy is current rather than a stale version.
    if (pragmaNumber(source, "data_version") !== before) {
      throw new Error(
        "the database was written to while it was being copied — the copy is already stale. " +
          "Nothing has been swapped; confirm ingest is paused and re-run.",
      );
    }

    const compactedBytes = statSync(workingPath).size;
    log("copy verified", {
      compactedMB: Math.round(compactedBytes / 1e6),
      tables: tables.length,
      integrity: verdict,
    });

    source.close();

    // Kept, not deleted, until a human has seen the new one serving. Its WAL and shm
    // go with it: a stale `-wal` beside the new database is one SQLite recovers from.
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${dbPath}${suffix}`)) renameSync(`${dbPath}${suffix}`, `${backupPath}${suffix}`);
    }
    renameSync(workingPath, dbPath);

    const finalVerdict = integrityOf(dbPath);
    if (finalVerdict !== "ok") {
      throw new Error(
        `the swapped-in database failed integrity_check: ${finalVerdict}. The previous file is at ${backupPath}`,
      );
    }

    result = {
      ...plan,
      backupPath,
      compactedBytes,
      durationMs: Date.now() - startedAt,
      verifiedTables: tables.length,
    };
  } catch (error) {
    // Leave the original alone and clear the partial copy.
    rmSync(workingPath, { force: true });
    throw error;
  } finally {
    try {
      source.close();
    } catch {
      // Already closed before the swap, in the successful path.
    }
  }

  log("compaction complete", {
    fromMB: Math.round(result.fileBytes / 1e6),
    toMB: Math.round(result.compactedBytes / 1e6),
    reclaimedMB: Math.round((result.fileBytes - result.compactedBytes) / 1e6),
    durationMs: result.durationMs,
    backupPath: result.backupPath,
  });
  return result;
}
