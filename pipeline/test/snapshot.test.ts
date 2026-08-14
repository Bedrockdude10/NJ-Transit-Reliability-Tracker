import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  prunable,
  requiredBytes,
  restoreSnapshot,
  snapshotDatabase,
  snapshotName,
} from "../src/maintenance/snapshot";

/**
 * The raw archive exists on exactly one Fly volume. These cover the half of a
 * backup that can be tested without a destination: producing a copy that is
 * consistent, verified, and restorable.
 */

let dir: string;
let dbPath: string;
let outDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-snapshot-"));
  dbPath = join(dir, "njt.sqlite");
  outDir = join(dir, "snapshots");
  mkdirSync(outDir, { recursive: true });

  // A WAL database with rows, as production is.
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE snapshots_of (id INTEGER PRIMARY KEY, payload BLOB)");
  const insert = db.prepare("INSERT INTO snapshots_of (payload) VALUES (?)");
  for (let i = 0; i < 500; i++) insert.run(Buffer.alloc(512, i % 256));
  db.close();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (over: Partial<Parameters<typeof snapshotDatabase>[0]> = {}) =>
  snapshotDatabase({ dbPath, outDir, keep: 7, ...over });

describe("taking a snapshot", () => {
  it("produces a restorable copy of the data", async () => {
    const { path } = await run();

    const restored = join(dir, "restored.sqlite");
    await restoreSnapshot(path, restored);

    const db = new DatabaseSync(restored, { readOnly: true });
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM snapshots_of").get() as { n: number };
    db.close();
    expect(n).toBe(500);
  });

  it("compresses, and reports both sizes", async () => {
    const result = await run();
    expect(result.compressedBytes).toBeLessThan(result.sourceBytes);
    expect(statSync(result.path).size).toBe(result.compressedBytes);
  });

  it("leaves nothing behind but the finished file", async () => {
    // A crash mid-run must not leave a truncated `.partial` or a 3GB `.raw`
    // sitting on the volume the live database shares.
    await run();
    const leftovers = readdirSync(outDir).filter((n) => n.endsWith(".partial") || n.endsWith(".raw"));
    expect(leftovers).toEqual([]);
  });

  it("works while the database is being written to", async () => {
    // The pipeline never stops polling, so this runs against a live writer.
    const writer = new DatabaseSync(dbPath);
    writer.exec("PRAGMA journal_mode = WAL");
    const insert = writer.prepare("INSERT INTO snapshots_of (payload) VALUES (?)");
    try {
      insert.run(Buffer.alloc(64, 1));
      const result = await run();
      insert.run(Buffer.alloc(64, 2));
      expect(result.compressedBytes).toBeGreaterThan(0);
    } finally {
      writer.close();
    }
  });

  it("refuses to start when the volume lacks room", async () => {
    // Filling the volume would take the live database down with it — a backup
    // job causing an outage.
    await expect(run({ freeBytes: () => 1024 })).rejects.toThrow(/not enough room/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("asks for meaningfully more room than the database occupies", () => {
    // The uncompressed copy alone is about the size of the source.
    expect(requiredBytes(3_000_000_000)).toBeGreaterThan(3_000_000_000);
  });
});

describe("naming and retention", () => {
  it("names snapshots so they sort chronologically as strings", () => {
    const earlier = snapshotName(new Date("2026-08-14T09:00:00Z"));
    const later = snapshotName(new Date("2026-08-14T15:08:44Z"));
    expect([later, earlier].sort()).toEqual([earlier, later]);
    expect(later).toBe("njt-20260814T150844Z.sqlite.gz");
  });

  it("keeps the newest and prunes the rest", () => {
    const names = ["njt-20260101T000000Z.sqlite.gz", "njt-20260102T000000Z.sqlite.gz", "njt-20260103T000000Z.sqlite.gz"];
    expect(prunable(names, 2)).toEqual(["njt-20260101T000000Z.sqlite.gz"]);
    expect(prunable(names, 5)).toEqual([]);
  });

  it("ignores files it did not write", () => {
    // Never delete something a human or an uploader put here.
    expect(prunable(["notes.txt", "njt-20260101T000000Z.sqlite.gz", "njt-partial.gz"], 0)).toEqual([
      "njt-20260101T000000Z.sqlite.gz",
    ]);
  });

  it("prunes on the way out, honouring keep", async () => {
    for (const name of ["njt-20250101T000000Z.sqlite.gz", "njt-20250102T000000Z.sqlite.gz"]) {
      writeFileSync(join(outDir, name), "old");
    }
    const result = await run({ keep: 1 });
    expect(result.pruned).toHaveLength(2);
    expect(readdirSync(outDir)).toEqual([result.path.split("/").pop()]);
  });
});

describe("verification", () => {
  it("rejects a corrupt snapshot rather than trusting it", async () => {
    // An unverified backup is a guess; discovering the corruption during a
    // restore is discovering it too late.
    const bogus = join(dir, "bogus.sqlite.gz");
    writeFileSync(bogus, "this is not gzip");
    await expect(restoreSnapshot(bogus, join(dir, "out.sqlite"))).rejects.toThrow();
  });

  it("reports a missing snapshot plainly", async () => {
    await expect(restoreSnapshot(join(dir, "nope.gz"), join(dir, "out.sqlite"))).rejects.toThrow(/no snapshot at/);
  });
});
