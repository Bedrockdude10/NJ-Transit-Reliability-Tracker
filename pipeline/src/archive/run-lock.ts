import { openSync, closeSync, readFileSync, rmSync, writeSync } from "node:fs";

/**
 * A single-holder lock for maintenance jobs that share the database.
 *
 * Two archive copies running at once is not a hypothetical: a scheduled run and
 * a manual one overlapped in production, the second counted rows the first was
 * deleting underneath it, and its own safety check refused to delete an hour it
 * could only partly account for. Nothing was lost — that check exists for this —
 * but the run failed for a reason that had nothing to do with the archive.
 *
 * A lock file rather than anything cleverer because the contenders are separate
 * processes on one machine, which is exactly what a file on that machine
 * describes. The volume attaches to a single machine, so there is no second host
 * to coordinate with.
 */

/**
 * How long before a lock is assumed to belong to a process that is gone.
 *
 * A killed run leaves its file behind — which happened here, since a container
 * kills the process group when an SSH session ends — and a stale lock that
 * blocks every future run is worse than the collision it prevents.
 */
export const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

export interface LockHolder {
  pid: number;
  startedAtMs: number;
}

/** Whether a lock file's contents should be disregarded. */
export function isStale(holder: LockHolder, nowMs: number): boolean {
  return nowMs - holder.startedAtMs > STALE_LOCK_MS;
}

function readHolder(path: string): LockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockHolder>;
    if (typeof parsed.pid !== "number" || typeof parsed.startedAtMs !== "number") return null;
    return { pid: parsed.pid, startedAtMs: parsed.startedAtMs };
  } catch {
    // Unreadable or truncated — a half-written file from a process that died
    // mid-write is no evidence that anything is still running.
    return null;
  }
}

/**
 * Run `work` while holding the lock, releasing it however `work` ends.
 *
 * Throws rather than waiting if the lock is held: every caller here is either
 * scheduled, and will come round again, or interactive, and would rather be told.
 */
export async function withLock<T>(
  path: string,
  work: () => Promise<T>,
  options: { now?: () => number } = {},
): Promise<T> {
  const now = options.now ?? Date.now;

  let handle: number;
  try {
    handle = openSync(path, "wx");
  } catch {
    const holder = readHolder(path);
    if (holder && !isStale(holder, now())) {
      throw new Error(
        `another archive run holds ${path} (pid ${holder.pid}, started ${new Date(holder.startedAtMs).toISOString()})`,
      );
    }
    // Stale or unreadable: take it over.
    handle = openSync(path, "w");
  }

  try {
    writeSync(handle, JSON.stringify({ pid: process.pid, startedAtMs: now() }));
  } finally {
    closeSync(handle);
  }

  try {
    return await work();
  } finally {
    rmSync(path, { force: true });
  }
}
