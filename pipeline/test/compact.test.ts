import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactDatabase, inspect, planFromPragmas, requiredBytes } from "../src/maintenance/compact";

/**
 * Compaction replaces the live database, so the tests that matter are the ones
 * about refusing to.
 *
 * The failure this guards against is not a crash. It is a successful-looking run
 * that swaps in a copy taken before the last few minutes of ingest — a valid
 * database, missing data that cannot be re-fetched, with nothing to notice.
 */

let dir: string;
let dbPath: string;

/** A database with enough rows that deleting most of them leaves real free space. */
function seed(path: string, rows: number): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE raw_snapshots (id INTEGER PRIMARY KEY, blob BLOB NOT NULL)");
  db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, line TEXT NOT NULL)");
  const insertSnapshot = db.prepare("INSERT INTO raw_snapshots (blob) VALUES (?)");
  const payload = new Uint8Array(4096).fill(7);
  for (let i = 0; i < rows; i++) insertSnapshot.run(payload);
  const insertEvent = db.prepare("INSERT INTO events (line) VALUES (?)");
  for (let i = 0; i < 50; i++) insertEvent.run(`line-${i}`);
  db.close();
}

/** What the archive drain leaves behind: rows gone, pages still in the file. */
function drain(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("DELETE FROM raw_snapshots");
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-compact-"));
  dbPath = join(dir, "njt.sqlite");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("planning", () => {
  it("separates what the file occupies from what it holds", () => {
    expect(planFromPragmas({ pageCount: 1000, pageSize: 4096, freelistCount: 800 })).toEqual({
      fileBytes: 4_096_000,
      liveBytes: 819_200,
      reclaimableBytes: 3_276_800,
    });
  });

  it("asks for room for the copy plus a margin, since both files exist at once", () => {
    expect(requiredBytes(600_000_000)).toBeGreaterThan(600_000_000);
  });

  it("sees the space a drain freed inside a real database", () => {
    seed(dbPath, 400);
    drain(dbPath);
    const plan = inspect({ dbPath });
    expect(plan.reclaimableBytes).toBeGreaterThan(0);
    expect(plan.liveBytes).toBeLessThan(plan.fileBytes);
    expect(plan.rawSnapshots).toBe(0);
  });
});

describe("refusing to run", () => {
  beforeEach(() => {
    seed(dbPath, 200);
    drain(dbPath);
  });

  it("will not fill the volume it is trying to protect", async () => {
    await expect(
      compactDatabase({ dbPath, apply: true, freeBytes: () => 1024, quiesceMs: 0 }),
    ).rejects.toThrow(/not enough room/u);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("will not compact mid-drain, since those pages are about to be freed anyway", async () => {
    seed(join(dir, "undrained.sqlite"), 50);
    await expect(
      compactDatabase({ dbPath: join(dir, "undrained.sqlite"), apply: true, quiesceMs: 0 }),
    ).rejects.toThrow(/raw snapshots still to drain/u);
  });

  /**
   * The one that protects the data. `VACUUM INTO` copies the database as of the
   * moment it starts; a writer that is still running means the copy is missing
   * whatever it wrote next, and swapping it in loses that silently.
   */
  it("will not swap when something is still writing", async () => {
    const writer = new DatabaseSync(dbPath);
    try {
      await expect(
        compactDatabase({
          dbPath,
          apply: true,
          quiesceMs: 1,
          // A commit lands from another connection while it is watching.
          sleep: async () => {
            writer.exec("INSERT INTO events (line) VALUES ('written during maintenance')");
          },
        }),
      ).rejects.toThrow(/still being written to/u);
    } finally {
      writer.close();
    }
    expect(existsSync(`${dbPath}.pre-compact`)).toBe(false);
    expect(existsSync(`${dbPath}.compacting`)).toBe(false);
  });

  it("leaves the database untouched when it refuses", async () => {
    const before = statSync(dbPath).size;
    await expect(
      compactDatabase({ dbPath, apply: true, freeBytes: () => 1, quiesceMs: 0 }),
    ).rejects.toThrow();
    expect(statSync(dbPath).size).toBe(before);
  });

  it("refuses rather than overwrite a backup a previous run left behind", async () => {
    seed(`${dbPath}.pre-compact`, 1);
    await expect(compactDatabase({ dbPath, apply: true, quiesceMs: 0 })).rejects.toThrow(
      /has not been cleaned up/u,
    );
  });
});

describe("dry run", () => {
  it("reports what it would reclaim and writes nothing", async () => {
    seed(dbPath, 300);
    drain(dbPath);
    const before = statSync(dbPath).size;

    const result = await compactDatabase({ dbPath, apply: false, quiesceMs: 0 });

    expect(result.reclaimableBytes).toBeGreaterThan(0);
    expect(statSync(dbPath).size).toBe(before);
    expect(existsSync(`${dbPath}.pre-compact`)).toBe(false);
    expect(existsSync(`${dbPath}.compacting`)).toBe(false);
  });
});

describe("compacting", () => {
  beforeEach(() => {
    seed(dbPath, 400);
    drain(dbPath);
  });

  it("shrinks the file and keeps every row", async () => {
    const before = statSync(dbPath).size;

    const result = await compactDatabase({ dbPath, apply: true, quiesceMs: 0 });

    expect(statSync(dbPath).size).toBeLessThan(before);
    expect(result.verifiedTables).toBe(2);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(50);
      expect((db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>).integrity_check)
        .toBe("ok");
    } finally {
      db.close();
    }
  });

  it("keeps the old database until someone has decided the new one is good", async () => {
    const result = await compactDatabase({ dbPath, apply: true, quiesceMs: 0 });
    expect(existsSync(result.backupPath)).toBe(true);

    // And it is still a usable database, not a truncated remnant.
    const old = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      expect((old.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(50);
    } finally {
      old.close();
    }
  });

  it("moves the WAL aside with the file it belongs to", async () => {
    // A `-wal` left beside the new database is one SQLite would try to recover
    // from, against a database it was never written for.
    //
    // The WAL is created on demand and checkpointed away on a clean close, so
    // reproducing production here means holding open a connection that has
    // written — which is what the machine looks like when this runs.
    const holder = new DatabaseSync(dbPath);
    try {
      holder.exec("INSERT INTO events (line) VALUES ('open connection')");
      expect(existsSync(`${dbPath}-wal`)).toBe(true);

      await compactDatabase({ dbPath, apply: true, quiesceMs: 0 });

      expect(existsSync(`${dbPath}-wal`)).toBe(false);
      expect(existsSync(`${dbPath}.pre-compact-wal`)).toBe(true);
    } finally {
      holder.close();
    }
  });

  it("leaves no working file behind", async () => {
    await compactDatabase({ dbPath, apply: true, quiesceMs: 0 });
    expect(existsSync(`${dbPath}.compacting`)).toBe(false);
  });
});
