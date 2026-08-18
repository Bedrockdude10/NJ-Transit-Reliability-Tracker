import { openSync, closeSync, readFileSync, rmSync, writeSync } from "node:fs";

/**
 * A single-holder lock, named for the **set of rows** a job mutates rather than for
 * "the archive". One lock across every maintenance job starved the events export
 * behind a backlog drain, though the two touch different tables; they contend for
 * memory, not rows, and memory has its own check.
 */

/**
 * How long before a lock is assumed to belong to a process that is gone. A killed run
 * leaves its file behind (a container kills the process group when an SSH session
 * ends), and a stale lock blocking every future run is worse than a collision.
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
    // A half-written file is no evidence that anything is still running.
    return null;
  }
}

/**
 * Run `work` while holding the lock, releasing it however `work` ends.
 *
 * Throws rather than waiting if the lock is held: every caller is either scheduled,
 * and will come round again, or interactive, and would rather be told.
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
