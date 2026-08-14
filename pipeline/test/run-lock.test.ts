import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STALE_LOCK_MS, isStale, withLock } from "../src/archive/run-lock";

/**
 * The lock exists because two archive copies overlapped in production: the
 * second counted rows the first was deleting, and refused to delete an hour it
 * could only partly account for.
 */

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-lock-"));
  lock = join(dir, "copy.lock");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("archive run lock", () => {
  it("runs the work and releases the lock", async () => {
    expect(await withLock(lock, async () => "done")).toBe("done");
    expect(existsSync(lock)).toBe(false);
  });

  it("refuses to start while another run holds it", async () => {
    await withLock(lock, async () => {
      await expect(withLock(lock, async () => "second")).rejects.toThrow(/another archive run/);
    });
  });

  it("releases the lock when the work throws", async () => {
    // Otherwise one failure would block every run that followed.
    await expect(withLock(lock, async () => { throw new Error("upload failed"); })).rejects.toThrow(
      "upload failed",
    );
    expect(existsSync(lock)).toBe(false);
  });

  it("takes over a lock left behind by a process that is gone", async () => {
    // A container kills the process group when an SSH session ends, so an
    // abandoned lock is expected, and one that blocked every future run would be
    // worse than the collision it prevents.
    writeFileSync(lock, JSON.stringify({ pid: 999, startedAtMs: Date.now() - STALE_LOCK_MS - 1 }));
    expect(await withLock(lock, async () => "taken over")).toBe("taken over");
  });

  it("takes over a lock file it cannot make sense of", async () => {
    writeFileSync(lock, "half-written");
    expect(await withLock(lock, async () => "taken over")).toBe("taken over");
  });

  it("treats a lock as stale only after the window", () => {
    const now = Date.now();
    expect(isStale({ pid: 1, startedAtMs: now - STALE_LOCK_MS + 1000 }, now)).toBe(false);
    expect(isStale({ pid: 1, startedAtMs: now - STALE_LOCK_MS - 1000 }, now)).toBe(true);
  });
});
