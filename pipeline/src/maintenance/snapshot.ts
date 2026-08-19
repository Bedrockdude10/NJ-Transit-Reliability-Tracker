import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const ISO_SEPARATORS_RE = /[-:]/gu;
const ISO_MILLIS_RE = /\.\d+Z$/u;
const SNAPSHOT_NAME_RE = /^njt-\d{8}T\d{6}Z\.sqlite\.gz$/u;

/**
 * Take a consistent, compressed copy of the live database. See DEPLOY.md → Backups.
 *
 * `VACUUM INTO` rather than a file copy: the file is written to continuously, so a
 * plain copy captures a torn mid-transaction state. It takes only a read transaction,
 * which under WAL does not block the pipeline.
 */
export interface SnapshotOptions {
  /** Live database to copy. */
  dbPath: string;
  /** Directory to write into. */
  outDir: string;
  /** How many snapshots to keep, newest first. */
  keep: number;
  /** Injected for tests. */
  now?: () => Date;
  freeBytes?: (path: string) => number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface SnapshotResult {
  path: string;
  sourceBytes: number;
  compressedBytes: number;
  durationMs: number;
  pruned: string[];
}

/** `njt-20260814T150844Z.sqlite.gz` — sorts chronologically as a string. */
export function snapshotName(at: Date): string {
  return `njt-${at.toISOString().replace(ISO_SEPARATORS_RE, "").replace(ISO_MILLIS_RE, "Z")}.sqlite.gz`;
}

/**
 * Snapshots older than the newest `keep`, by filename order — not mtime, so an
 * uploader that touches files or a restore that resets timestamps cannot reorder
 * history and delete the wrong one.
 */
export function prunable(names: readonly string[], keep: number): string[] {
  const snapshots = names.filter((n) => SNAPSHOT_NAME_RE.test(n)).sort();
  return keep <= 0 ? [...snapshots] : snapshots.slice(0, Math.max(0, snapshots.length - keep));
}

/**
 * Room needed before starting: the uncompressed copy is roughly the size of the
 * source, plus the compressed result, plus a margin. Checked up front because filling
 * the volume takes the live database down with it.
 */
export function requiredBytes(sourceBytes: number): number {
  return Math.ceil(sourceBytes * 1.2) + 64 * 1024 * 1024;
}

export async function snapshotDatabase(options: SnapshotOptions): Promise<SnapshotResult> {
  const { dbPath, outDir, keep } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const startedAt = Date.now();

  const sourceBytes = statSync(dbPath).size;
  const needed = requiredBytes(sourceBytes);
  const free = options.freeBytes?.(outDir) ?? Number.POSITIVE_INFINITY;
  if (free < needed) {
    throw new Error(
      `not enough room for a snapshot in ${outDir}: need ~${Math.round(needed / 1e6)}MB, have ${Math.round(free / 1e6)}MB`,
    );
  }

  const finalPath = join(outDir, snapshotName(now()));
  // `.partial` until it is complete, so a crash mid-run cannot leave a
  // truncated file that looks like a valid snapshot.
  const partialPath = `${finalPath}.partial`;
  const rawPath = `${finalPath}.raw`;

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      rmSync(rawPath, { force: true });
      db.exec(`VACUUM INTO '${rawPath.replace(/'/gu, "''")}'`);
    } finally {
      db.close();
    }

    verifySnapshot(rawPath);

    // Streamed, not buffered: a 3 GB database must never be held in memory to be
    // compressed on a 512 MB box.
    await pipeline(createReadStream(rawPath), createGzip({ level: 6 }), createWriteStream(partialPath));
  } finally {
    rmSync(rawPath, { force: true });
  }

  renameSync(partialPath, finalPath);

  const compressedBytes = statSync(finalPath).size;
  const pruned = pruneSnapshots(outDir, keep, log);
  const durationMs = Date.now() - startedAt;

  log("snapshot written", {
    path: finalPath,
    sourceMB: Math.round(sourceBytes / 1e6),
    compressedMB: Math.round(compressedBytes / 1e6),
    durationMs,
    pruned: pruned.length,
  });

  return { path: finalPath, sourceBytes, compressedBytes, durationMs, pruned };
}

/** Confirm the copy is a usable database before it is trusted as a backup. */
function verifySnapshot(path: string): void {
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    const row = copy.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    const verdict = row ? String(Object.values(row)[0]) : "no result";
    if (verdict !== "ok") throw new Error(`snapshot failed integrity_check: ${verdict}`);
  } finally {
    copy.close();
  }
}

function pruneSnapshots(
  outDir: string,
  keep: number,
  log: (message: string, meta?: Record<string, unknown>) => void,
): string[] {
  const stale = prunable(readdirSync(outDir), keep);
  for (const name of stale) {
    rmSync(join(outDir, name), { force: true });
    log("snapshot pruned", { name });
  }
  return stale;
}

/** Restore-side counterpart, so the format is never write-only. */
export async function restoreSnapshot(gzPath: string, outPath: string): Promise<void> {
  if (!existsSync(gzPath)) throw new Error(`no snapshot at ${gzPath}`);
  await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(outPath));
  verifySnapshot(outPath);
}
