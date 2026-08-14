import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import { configureStore, type ObjectStore } from "../src/archive/export-events";
import {
  archiveKey,
  dayBounds,
  insufficientMemory,
  integerLiteral,
  parseAvailableMemoryMb,
  typedProjection,
  sweepSnapshots,
  sweepableDates,
  utcDate,
  windowQuery,
} from "../src/archive/sweep-snapshots";

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

describe("fitting on the machine", () => {
  it("refuses to start when the box has no room, before touching anything", async () => {
    // The first production run was OOM-killed: 192 MB for DuckDB on a box with
    // 184 MB free, because the limit had been set against the machine's nominal
    // 512 MB rather than what the API and pipeline leave behind. Exit code 137
    // explains none of that, so the check happens up front and says so.
    seed(["2026-08-10"]);
    await expect(run({ availableMemoryMb: () => 150 })).rejects.toThrow(/not enough memory/);
    const { startMs, endMs } = dayBounds("2026-08-10");
    expect(repos.snapshots.dayExtent(startMs, endMs).rows).toBe(6);
  });

  it("reports how much is needed and how much there is", () => {
    expect(insufficientMemory(64, 100)).toMatch(/need ~279 MB \(64 MB for DuckDB.*100 MB available/);
  });

  it("proceeds when the budget fits", () => {
    expect(insufficientMemory(64, 279)).toBeNull();
  });

  it("reads the kernel's own estimate of what is allocatable", () => {
    // MemAvailable, not MemFree: the two differ by the reclaimable page cache,
    // which is most of a busy machine's memory.
    const meminfo = "MemTotal:         469852 kB\nMemFree:          130360 kB\nMemAvailable:     184384 kB\n";
    expect(parseAvailableMemoryMb(meminfo)).toBe(180);
  });

  it("skips the check where the kernel does not answer, rather than guessing", () => {
    // Off Linux there is no MemAvailable. os.freemem() is not a substitute — on
    // macOS it reported 71 MB on a 64 GB machine.
    expect(parseAvailableMemoryMb("VmStat: nope")).toBeNull();
    expect(insufficientMemory(64, null)).toBeNull();
  });

  it("reads each window through SQLite rather than scanning the table in DuckDB", () => {
    // The distinction is the whole memory profile: DuckDB filtering an attached
    // table pulls every blob in the archive through its buffer manager, so cost
    // scales with the archive; SQLite answers the same window from a covering
    // index and returns only those rows.
    const q = windowQuery("id", 1_000, 2_000);
    expect(q).toContain("sqlite_query('live'");
    expect(q).toContain("fetched_at_ms >= 1000");
    expect(q).toContain("fetched_at_ms < 2000");
  });

  it("restores the live table's types, which sqlite_query flattens to strings", () => {
    // Every column comes back VARCHAR, blobs included. Left alone, the archive
    // quietly becomes an all-strings copy, and reading a blob back fails outright
    // because those bytes are not valid UTF-8.
    const projection = typedProjection([
      { name: "id", type: "BIGINT" },
      { name: "feed_type", type: "VARCHAR" },
      { name: "raw_bytes", type: "BLOB" },
    ]);
    expect(projection).toBe(
      "CAST(id AS BIGINT) AS id, CAST(feed_type AS VARCHAR) AS feed_type, encode(raw_bytes) AS raw_bytes",
    );
  });

  it("rejects anything odd in a column name or type before interpolating it", () => {
    expect(() => typedProjection([{ name: "id; DROP TABLE", type: "BIGINT" }])).toThrow(/column name/);
    expect(() => typedProjection([{ name: "id", type: "BIGINT); --" }])).toThrow(/column type/);
  });

  it("refuses a bound that is not a plain integer, since it is interpolated", () => {
    // sqlite_query nests SQL in SQL and the inner string cannot bind parameters.
    expect(() => integerLiteral(1.5)).toThrow(/safe integer/);
    expect(() => integerLiteral(Number.NaN)).toThrow(/safe integer/);
    expect(integerLiteral(1_755_000_000_000)).toBe("1755000000000");
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

  it("writes the archive with the live table's schema, not stringified", async () => {
    // The guarantee is that a swept day can be read back as what it was. An
    // earlier version wrote every column as VARCHAR; the read-back failed on the
    // blob, which is the only reason it was noticed.
    seed(["2026-08-10"]);
    const [day] = await run();
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    try {
      await connection.run("INSTALL sqlite; LOAD sqlite;");
      await configureStore(connection, STORE);
      await connection.run(`ATTACH '${dbPath}' AS live (TYPE sqlite, READ_ONLY)`);
      const describe = async (source: string) =>
        (await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`))
          .getRowObjects()
          .map((row) => `${row.column_name}:${row.column_type}`);
      const live = await describe("live.raw_snapshots");
      const archived = await describe(`'${day!.hours[0]!.uri}'`);
      // The two extras are the hive partition columns DuckDB reads out of the key
      // path itself (`date=…/hour=…`), not data.
      expect(archived).toEqual([...live, "date:DATE", "hour:VARCHAR"]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
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

describe.skipIf(!online)("bounding a run", () => {
  it("stops after maxDays, leaving the rest for the next run", async () => {
    // The first production run has ~29 days to move on a box that has already
    // been starved into an outage by one large job.
    seed(["2026-08-08", "2026-08-09", "2026-08-10"]);
    const first = await run({ olderThanDays: 2, maxDays: 2 });
    expect(first.map((d) => d.date)).toEqual(["2026-08-08", "2026-08-09"]);

    const second = await run({ olderThanDays: 2, maxDays: 2 });
    expect(second.map((d) => d.date)).toEqual(["2026-08-10"]);
  }, 60_000);

  it("sweeps everything eligible when uncapped", async () => {
    seed(["2026-08-08", "2026-08-09"]);
    expect((await run({ olderThanDays: 2 })).length).toBe(2);
  }, 60_000);
});
