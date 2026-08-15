import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RestoreVerificationError,
  compareCounts,
  verifyRestore,
  worstShortfall,
} from "../src/maintenance/verify-restore";

/**
 * The half of a backup people discover they never had.
 *
 * Replication logs success whether or not the result can be restored, so these
 * tests are about the ways a restore can look fine and not be: an empty file, a
 * corrupt one, or one that opens cleanly and is missing a table's worth of rows.
 *
 * `restore` is injected, so this exercises the judgement without a bucket. What
 * cannot be tested here is Litestream itself — see DEPLOY.md for running it
 * against the real replica, which is the run that counts.
 */

let dir: string;
let dbPath: string;
let scratchPath: string;

function seed(path: string, events: number): void {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE trip_stop_events (id INTEGER PRIMARY KEY, line TEXT NOT NULL)");
  db.exec("CREATE TABLE predictions (id INTEGER PRIMARY KEY, trip TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO trip_stop_events (line) VALUES (?)");
  for (let i = 0; i < events; i++) insert.run(`line-${i}`);
  db.prepare("INSERT INTO predictions (trip) VALUES (?)").run("T1");
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-restore-"));
  dbPath = join(dir, "njt.sqlite");
  scratchPath = join(dir, "njt.restore-check.sqlite");
  seed(dbPath, 100);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A replica that is a faithful copy of the live database. */
const perfectReplica = async (to: string) => copyFileSync(dbPath, to);

describe("comparing counts", () => {
  it("reports how far behind each table is", () => {
    const comparisons = compareCounts(
      new Map([["events", 100], ["predictions", 4]]),
      new Map([["events", 98], ["predictions", 4]]),
    );
    expect(comparisons).toEqual([
      { table: "events", live: 100, restored: 98, behind: 2 },
      { table: "predictions", live: 4, restored: 4, behind: 0 },
    ]);
  });

  it("counts a table absent from the replica as entirely missing", () => {
    expect(compareCounts(new Map([["events", 10]]), new Map())[0]).toMatchObject({
      restored: 0,
      behind: 10,
    });
  });

  it("does not treat a replica that is ahead as behind", () => {
    // A write can land between reading the replica and reading the original.
    expect(worstShortfall(compareCounts(new Map([["events", 10]]), new Map([["events", 12]])))).toBe(0);
  });

  it("measures the shortfall against the table's own size", () => {
    // Ten rows behind is nothing on a million and total loss on eleven.
    expect(worstShortfall([{ table: "a", live: 100, restored: 99, behind: 1 }])).toBeCloseTo(0.01);
  });

  it("ignores tables that are legitimately empty on both sides", () => {
    expect(worstShortfall([{ table: "a", live: 0, restored: 0, behind: 0 }])).toBe(0);
  });
});

describe("verifying a restore", () => {
  it("passes when the replica matches the live database", async () => {
    const result = await verifyRestore({ dbPath, scratchPath, restore: perfectReplica });

    expect(result.integrity).toBe("ok");
    expect(result.worstShortfall).toBe(0);
    expect(result.tables.map((t) => t.table).sort()).toEqual(["predictions", "trip_stop_events"]);
  });

  it("tolerates the lag continuous replication actually has", async () => {
    // The pipeline commits every 30s and Litestream ships asynchronously, so an
    // exact match would fail for reasons that are not faults.
    await verifyRestore({
      dbPath,
      scratchPath,
      restore: async (to) => {
        copyFileSync(dbPath, to);
        const db = new DatabaseSync(to);
        db.exec("DELETE FROM trip_stop_events WHERE id > 99");
        db.close();
      },
    });
  });

  it("fails when the restore produces nothing at all", async () => {
    // The commonest real failure: no replica, and a `litestream restore` that
    // exits without writing a file.
    await expect(
      verifyRestore({ dbPath, scratchPath, restore: async () => {} }),
    ).rejects.toThrow(RestoreVerificationError);
  });

  it("fails on a restored file that is not a database", async () => {
    await expect(
      verifyRestore({
        dbPath,
        scratchPath,
        restore: async (to) => {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(to, "this is not a sqlite file, but it is a file");
        },
      }),
    ).rejects.toThrow();
  });

  it("fails when a whole table came back empty, which is not lag", async () => {
    await expect(
      verifyRestore({
        dbPath,
        scratchPath,
        restore: async (to) => {
          copyFileSync(dbPath, to);
          const db = new DatabaseSync(to);
          db.exec("DELETE FROM trip_stop_events");
          db.close();
        },
      }),
    ).rejects.toThrow(/missing every row of: trip_stop_events/);
  });

  it("fails when the replica is further behind than the tolerance allows", async () => {
    await expect(
      verifyRestore({
        dbPath,
        scratchPath,
        restore: async (to) => {
          copyFileSync(dbPath, to);
          const db = new DatabaseSync(to);
          db.exec("DELETE FROM trip_stop_events WHERE id > 50");
          db.close();
        },
      }),
    ).rejects.toThrow(/behind, past the/);
  });

  it("refuses rather than fill the volume it restores onto", async () => {
    await expect(
      verifyRestore({ dbPath, scratchPath, restore: perfectReplica, freeBytes: () => 1 }),
    ).rejects.toThrow(/not enough room/);
  });

  it("never touches the live database", async () => {
    const before = new DatabaseSync(dbPath, { readOnly: true });
    const count = (before.prepare("SELECT count(*) AS n FROM trip_stop_events").get() as { n: number }).n;
    before.close();

    await verifyRestore({ dbPath, scratchPath, restore: perfectReplica }).catch(() => {});

    const after = new DatabaseSync(dbPath, { readOnly: true });
    expect((after.prepare("SELECT count(*) AS n FROM trip_stop_events").get() as { n: number }).n).toBe(count);
    after.close();
  });

  it("cleans up the scratch copy, in success and in failure alike", async () => {
    await verifyRestore({ dbPath, scratchPath, restore: perfectReplica });
    expect(existsSync(scratchPath)).toBe(false);

    await expect(
      verifyRestore({
        dbPath,
        scratchPath,
        restore: async (to) => {
          copyFileSync(dbPath, to);
          const db = new DatabaseSync(to);
          db.exec("DELETE FROM trip_stop_events");
          db.close();
        },
      }),
    ).rejects.toThrow();
    expect(existsSync(scratchPath)).toBe(false);
  });

  it("does not mistake an interrupted run's leftovers for a fresh restore", async () => {
    copyFileSync(dbPath, scratchPath);
    await expect(
      verifyRestore({ dbPath, scratchPath, restore: async () => {} }),
    ).rejects.toThrow(/produced no database/);
  });
});
