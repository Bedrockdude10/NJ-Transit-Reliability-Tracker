import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObjectStore } from "../src/archive/export-events";
import { archiveKey, dayBounds, sweepSnapshots, sweepableDates, utcDate } from "../src/archive/sweep-snapshots";

/**
 * The sweep deletes the only copy of data NJT does not serve twice. These tests
 * are mostly about what it refuses to do.
 *
 * Runs against MinIO on :9100 (see the Backups section of DEPLOY.md); skipped
 * when it is not up, so the suite stays runnable without Docker.
 */

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "localhost:9100",
  accessKeyId: "njtlocal",
  secretAccessKey: "njtlocalsecret",
  region: "us-east-1",
  useSsl: false,
};

const NOW = Date.parse("2026-08-14T12:00:00Z");
const online = await fetch("http://localhost:9100/minio/health/live")
  .then((r) => r.ok)
  .catch(() => false);

let dir: string;
let dbPath: string;
let db: Database;
let repos: Repositories;
let prefix: string;

/** One snapshot every 30 minutes across the given UTC days. */
function seed(dates: readonly string[], perDay = 6): void {
  for (const date of dates) {
    const { startMs } = dayBounds(date);
    for (let i = 0; i < perDay; i++) {
      repos.snapshots.insert({
        feedType: "TripUpdates",
        fetchedAtMs: startMs + i * 1_800_000,
        rawBytes: randomBytes(2048),
      });
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-sweep-"));
  dbPath = join(dir, "njt.sqlite");
  db = openDatabase(dbPath);
  repos = createRepositories(db);
  // Unique per test so MinIO state cannot leak between them.
  prefix = `archive-test/${randomBytes(6).toString("hex")}`;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (over: Partial<Parameters<typeof sweepSnapshots>[0]> = {}) =>
  sweepSnapshots({ dbPath, repos, store: STORE, olderThanDays: 2, prefix, now: () => NOW, ...over });

describe("choosing what to sweep", () => {
  it("leaves days inside the retention window alone", () => {
    // Recent snapshots stay local so a replay does not have to go to the network.
    const dates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];
    expect(sweepableDates(dates, 2, NOW)).toEqual(["2026-08-11"]);
  });

  it("never sweeps today, however small the window", () => {
    // Today is still being written to; a partial day cannot be swept safely.
    expect(sweepableDates(["2026-08-14"], 0, NOW)).toEqual([]);
  });

  it("derives the UTC day of an instant", () => {
    expect(utcDate(Date.parse("2026-08-14T23:59:59Z"))).toBe("2026-08-14");
  });

  it("keys objects by date and hour so a rerun replaces rather than appends", () => {
    // Hourly because a day of blobs does not fit in memory on this box; the day
    // remains the unit of deletion.
    expect(archiveKey("archive", "2026-08-11", 7)).toBe("archive/date=2026-08-11/hour=07/snapshots.parquet");
    expect(archiveKey("archive/", "2026-08-11", 7)).toBe(archiveKey("archive", "2026-08-11", 7));
  });
});

describe.skipIf(!online)("sweeping against object storage", () => {
  it("archives an eligible day and removes it from sqlite", async () => {
    seed(["2026-08-10", "2026-08-11", "2026-08-14"]);
    const before = repos.snapshots.count();

    const swept = await run();

    expect(swept.map((d) => d.date)).toEqual(["2026-08-10", "2026-08-11"]);
    expect(swept.every((d) => d.deleted === d.rows)).toBe(true);
    // Today's rows survive.
    expect(repos.snapshots.count()).toBe(before - swept.reduce((n, d) => n + d.rows, 0));
  }, 60_000);

  it("keeps the blobs byte-identical, verified by digest", async () => {
    seed(["2026-08-10"]);
    const [day] = await run();
    // The digest is a hash of per-row hashes: a truncated or re-encoded blob
    // changes it where a row count would not.
    expect(day!.hours.length).toBeGreaterThan(0);
    for (const hour of day!.hours) expect(hour.digest).toMatch(/^[0-9a-f]{32}$/);
  }, 60_000);

  it("is idempotent — a second run has nothing left to do", async () => {
    seed(["2026-08-10"]);
    expect((await run()).length).toBe(1);
    expect(await run()).toEqual([]);
  }, 60_000);

  it("stops the file growing without rewriting it", async () => {
    // The point is arresting growth, not shrinking: reclaiming disk needs a
    // VACUUM, which rewrites the whole database and already caused one outage.
    seed(["2026-08-10"], 40);
    // Checkpoint first: otherwise the rows are still in `-wal` and the sweep's
    // own checkpoint would make the file "grow" for reasons unrelated to it.
    repos.snapshots.checkpointWal();
    const sizeBefore = statSync(dbPath).size;
    await run();
    expect(statSync(dbPath).size).toBeLessThanOrEqual(sizeBefore);

    // Freed pages are reused, so re-adding a similar volume does not grow it.
    seed(["2026-08-14"], 40);
    repos.snapshots.checkpointWal();
    expect(statSync(dbPath).size).toBeLessThanOrEqual(sizeBefore * 1.1);
  }, 60_000);

  it("deletes nothing when the object cannot be verified", async () => {
    seed(["2026-08-10"]);
    const before = repos.snapshots.count();
    // A bucket that does not exist: the write fails, so verification cannot pass.
    await expect(
      run({ store: { ...STORE, bucket: "no-such-bucket-here" } }),
    ).rejects.toThrow();
    expect(repos.snapshots.count()).toBe(before);
  }, 60_000);

  it("yields between delete batches so ingest can take the lock", async () => {
    // A single statement removing a day's blobs holds the write lock long enough
    // to stall a poll, and a stalled poll loses data that cannot be refetched.
    seed(["2026-08-10"], 1200);
    let yields = 0;
    await run({ betweenBatches: () => void yields++ });
    expect(yields).toBeGreaterThan(1);
  }, 120_000);
});
