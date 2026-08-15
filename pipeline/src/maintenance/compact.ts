import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Reclaim the disk the archive drain freed inside the database.
 *
 * Deleting rows returns their pages to SQLite's freelist, not to the filesystem:
 * the file stops growing but does not shrink, which is what the volume ceiling
 * needed and all `archive:copy` ever promised. It leaves a file that is mostly
 * hole — 3.81 GB holding 599 MB — and that is not free. Every backup copies it,
 * and Litestream's first snapshot has to ship all of it, which is precisely what
 * starved the API into a twelve-minute outage last time.
 *
 * `VACUUM INTO`, not `VACUUM`. Plain `VACUUM` rewrites the database in place
 * through a journal, taking an exclusive lock and needing room for a second copy
 * anyway — the same rewrite-everything load that caused the outage, applied to
 * the live file. `VACUUM INTO` writes a fresh, already-compact database
 * elsewhere while readers carry on, and leaves the original untouched until
 * something has checked the result.
 *
 * ## Why this cannot run against a live writer
 *
 * `VACUUM INTO` reads inside a transaction, so the copy is the database as of
 * the instant it began. The pipeline writes continuously. Swapping in a copy
 * taken five minutes ago discards five minutes of ingest — silently, because the
 * result is a perfectly valid database that simply lacks them, and NJT serves no
 * history to re-fetch them from.
 *
 * So ingest is paused first (`deploy/maintenance.mjs`), and this refuses to swap
 * unless it can *prove* nothing wrote while it worked, rather than trusting that
 * the pause took. `PRAGMA data_version` is the proof: SQLite bumps it in this
 * connection whenever another connection commits. Sampled before the copy and
 * again after, an unchanged value means the copy is current.
 */

export interface CompactOptions {
  dbPath: string;
  /** Preview only unless set. Every destructive step is behind this. */
  apply: boolean;
  /**
   * Refuse to run while more than this many raw snapshots remain.
   *
   * Compacting mid-drain wastes the work: the pages the drain is about to free
   * get copied into the new file, and the file grows straight back.
   */
  maxRawSnapshots?: number;
  /** How long to watch for writes before trusting the pause. */
  quiesceMs?: number;
  freeBytes?: (path: string) => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface CompactPlan {
  /** What the file occupies on disk. */
  fileBytes: number;
  /** What it would occupy with the free pages gone. */
  liveBytes: number;
  /** The difference — what compacting gives back. */
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
  /** Tables whose row counts were compared, source against copy. */
  verifiedTables: number;
}

/**
 * Room needed before starting.
 *
 * The copy is the size of the live data, and it lands on the same volume as the
 * original, which stays until the copy is proven — both exist at once, on
 * purpose. The margin covers WAL growth and the run's own overhead. Checked up
 * front because filling this volume takes the live database down with it, and a
 * maintenance job that causes an outage is worse than a large file.
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

/** User tables, so the row-count comparison covers everything without a list to maintain. */
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
    // Names come from sqlite_master rather than from a caller, and are quoted
    // anyway so a table called `order` or `group` counts like any other.
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

/**
 * Inspect without changing anything. This is what `--dry-run` reports.
 */
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
    // Watch for writes before touching anything. If ingest is still running the
    // pause did not take, and going ahead would discard whatever it writes next.
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

    // Row counts, table by table, source against copy. `integrity_check` proves
    // the copy is a well-formed database; it says nothing about it being a copy
    // of *this* one.
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

    // The whole reason this is safe: nothing committed while the copy was being
    // taken, so the copy is the database rather than a stale version of it.
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

    // Move the old database aside rather than deleting it: it stays until a
    // human has seen the new one serving. Its WAL and shm go with it — they
    // belong to that file, and a stale `-wal` left beside the new database is
    // one SQLite would try to recover from.
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
    // Leave the original alone and clear the partial copy. Failing here costs a
    // maintenance window; a half-swapped database costs the data.
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
