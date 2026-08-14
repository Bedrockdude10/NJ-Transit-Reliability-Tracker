import { DuckDBInstance } from "@duckdb/node-api";
import type { Repositories } from "@njt/db";
import type { Logger } from "@njt/shared/logger";
import type { ObjectStore } from "./export-events";
import { configureStore, literal } from "./export-events";

/**
 * Drain the raw snapshot archive out of SQLite and into object storage.
 *
 * `raw_snapshots` is ~3.7 GB of the 3.76 GB database and grows 130 MB/day, which
 * fills the volume, makes every backup expensive, and made Litestream's first
 * snapshot heavy enough to starve the API. The blobs belong in object storage;
 * SQLite should hold the derived events and nothing large.
 *
 * Three properties matter more than speed here, because this deletes the one
 * thing in the system that cannot be re-fetched — NJT serves no history.
 *
 * **Whole UTC days only.** A partial day could be written, gain more rows from
 * the still-running pipeline, and the second write would not cover what the
 * first deleted. Days are closed before they are swept.
 *
 * **Hash before delete.** The written object is read back and its content
 * digest compared with the source's. Row counts would miss a truncated or
 * mis-encoded blob; a digest does not. Nothing is deleted until they match.
 *
 * **No VACUUM.** Deleting frees pages inside the file for reuse rather than
 * shrinking it, so the file stops growing at its current size. That is what the
 * volume ceiling requires. A VACUUM rewrites the whole database and is the same
 * class of load that already caused one outage; it can happen later, chosen
 * deliberately, if the disk space is ever wanted back.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

export interface SweepOptions {
  dbPath: string;
  /**
   * Scratch space for DuckDB to spill into. A day is ~130 MB of blobs and this
   * box has 512 MB shared with the API and the pipeline, so the exporter is
   * capped and told to go to disk rather than compete for memory. Defaults
   * beside the database, which is the volume with room.
   */
  tempDir?: string;
  repos: Repositories;
  store: ObjectStore;
  /** Days must be at least this old before being swept. */
  olderThanDays: number;
  /**
   * Stop after this many days in one run. Unbounded by default.
   *
   * The first production run has ~29 days to move on a box that has already been
   * starved into an outage by a big one-off job. A cap makes the blast radius a
   * choice: run a couple of days, watch the health check, then widen.
   */
  maxDays?: number;
  prefix?: string;
  /** Injected for tests. */
  now?: () => number;
  /** Called between delete batches, to let the ingest poller take the lock. */
  betweenBatches?: () => void;
  log?: Logger;
}

export interface SweptHour {
  hour: number;
  rows: number;
  uri: string;
  digest: string;
}

export interface SweptDay {
  date: string;
  rows: number;
  hours: SweptHour[];
  deleted: number;
}

/** `2026-08-14` → the ms bounds of that UTC day. */
export function dayBounds(date: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${date}T00:00:00Z`);
  return { startMs, endMs: startMs + MS_PER_DAY };
}

/** The UTC date an instant falls in. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Which whole UTC days are old enough to sweep.
 *
 * Excludes today and anything inside the retention window, so the sweep never
 * races the writer and recent snapshots stay local for fast replay.
 */
export function sweepableDates(
  presentDates: readonly string[],
  olderThanDays: number,
  nowMs: number,
): string[] {
  const cutoff = utcDate(nowMs - olderThanDays * MS_PER_DAY);
  return [...presentDates].filter((date) => date < cutoff).sort();
}

/**
 * Object key for one hour of one day.
 *
 * Hours rather than whole days because a day is ~130 MB of blobs and DuckDB
 * cannot hold that on a 512 MB box — measured, it dies with "failed to pin
 * block" partway through, and giving it a spill directory does not help because
 * large values cannot be paged mid-operation. An hour is ~5 MB.
 *
 * Splitting a *closed* day is safe: nothing is writing to it. The day is still
 * the unit of deletion — every hour must be verified before any of it goes.
 */
export function archiveKey(prefix: string, date: string, hour: number): string {
  const hh = String(hour).padStart(2, "0");
  return `${prefix.replace(/\/+$/, "")}/date=${date}/hour=${hh}/snapshots.parquet`;
}

/**
 * Content digest of a day's blobs: a hash of the per-row hashes, in id order.
 *
 * Computed by DuckDB on both sides — over the attached SQLite and over the
 * written Parquet — so the comparison cannot fail merely because two engines
 * hash differently.
 */
const DIGEST = "md5(string_agg(md5(raw_bytes), '' ORDER BY id))";

export async function sweepSnapshots(options: SweepOptions): Promise<SweptDay[]> {
  const { dbPath, repos, store, olderThanDays } = options;
  const prefix = options.prefix ?? "archive";
  const now = options.now ?? Date.now;
  const log = options.log;

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const swept: SweptDay[] = [];

  try {
    // This box has 512 MB and has been OOM-killed twice. A day is ~130 MB of
    // blobs, so cap DuckDB rather than let it decide how much to buffer.
    // TimeZone pinned to UTC as a matter of hygiene: DuckDB's date functions
    // render timezone-aware values in the session zone, and a whole class of
    // off-by-a-day bug lives there. Nothing below relies on it — dates are
    // derived in TypeScript — but a future query should not have to know that.
    // Capped and given somewhere to spill. Without a temp directory this dies
    // with "failed to pin block" partway through a day — measured, on a
    // production-shaped database, before it ever ran anywhere real.
    const tempDir = options.tempDir ?? `${dbPath}.duckdb-tmp`;
    await connection.run(
      `SET memory_limit='192MB'; SET threads=2; SET TimeZone='UTC'; SET temp_directory=${literal(tempDir)};`,
    );
    await configureStore(connection, store);

    const eligible = sweepableDates(datesPresent(repos), olderThanDays, now());
    const candidates = options.maxDays ? eligible.slice(0, options.maxDays) : eligible;
    log?.info("sweep starting", {
      daysEligible: eligible.length,
      daysThisRun: candidates.length,
      olderThanDays,
    });

    for (const date of candidates) {
      const { startMs, endMs } = dayBounds(date);

      // The repository is authoritative: it reads through SQLite, so it sees
      // rows still in the WAL that a direct file read would miss.
      const expected = repos.snapshots.dayExtent(startMs, endMs).rows;
      if (expected === 0) continue;

      // Fresh, checkpointed view per day. DuckDB reads the file directly, so it
      // must be reattached after the previous day's delete — and the WAL flushed
      // first, or it sees a partial day and we delete a whole one.
      repos.snapshots.checkpointWal();
      await connection.run(`ATTACH ${literal(dbPath)} AS live (TYPE sqlite, READ_ONLY)`);

      const hours: SweptHour[] = [];
      try {
        for (let hour = 0; hour < 24; hour++) {
          const fromMs = startMs + hour * MS_PER_HOUR;
          const toMs = fromMs + MS_PER_HOUR;

          const read = await connection.runAndReadAll(
            `SELECT COUNT(*) AS rows, ${DIGEST} AS digest
             FROM live.raw_snapshots WHERE fetched_at_ms >= ? AND fetched_at_ms < ?`,
            [fromMs, toMs],
          );
          const row = read.getRowObjects()[0] as { rows: bigint | number; digest: string };
          const rows = Number(row.rows);
          if (rows === 0) continue;

          const uri = `s3://${store.bucket}/${archiveKey(prefix, date, hour)}`;
          await connection.run(
            `COPY (SELECT * FROM live.raw_snapshots WHERE fetched_at_ms >= ? AND fetched_at_ms < ? ORDER BY id)
             TO '${uri}' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE)`,
            [fromMs, toMs],
          );

          // Read it back. Nothing is deleted until every hour has matched.
          const written = await connection.runAndReadAll(
            `SELECT COUNT(*) AS rows, ${DIGEST} AS digest FROM '${uri}'`,
          );
          const check = written.getRowObjects()[0] as { rows: bigint | number; digest: string };
          if (Number(check.rows) !== rows || check.digest !== row.digest) {
            throw new Error(
              `archive verification failed for ${date} hour ${hour}: source ${rows} rows/${row.digest}, ` +
                `object ${Number(check.rows)} rows/${check.digest} — nothing deleted`,
            );
          }
          hours.push({ hour, rows, uri, digest: row.digest });
        }
      } finally {
        // Detach before deleting, so DuckDB is not holding a view of a file
        // about to change underneath it.
        await connection.run("DETACH live");
      }

      // The guarantee that makes the delete safe: everything SQLite holds for
      // this day is verifiably in object storage, hour by hour. A day the
      // exporter could not fully see is an error, never something to skip.
      const archived = hours.reduce((total, h) => total + h.rows, 0);
      if (archived !== expected) {
        throw new Error(
          `refusing to delete ${date}: sqlite holds ${expected} rows, ` +
            `only ${archived} are verified in object storage`,
        );
      }
      log?.info("day verified in object storage", { date, rows: archived, hours: hours.length });

      const deleted = repos.snapshots.deleteDay(startMs, endMs, {
        betweenBatches: options.betweenBatches,
      });
      log?.info("day removed from sqlite", { date, deleted });
      swept.push({ date, rows: archived, hours, deleted });
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  log?.info("sweep complete", {
    days: swept.length,
    rows: swept.reduce((total, day) => total + day.rows, 0),
  });
  return swept;
}

/**
 * Every UTC date the archive spans, oldest first.
 *
 * Derived from the repository's own min/max rather than asked of DuckDB. An
 * earlier version used `strftime(to_timestamp(...))`, which renders a
 * timezone-aware value in the *session* zone: run west of UTC, midnight-UTC rows
 * were reported as the previous day, so the sweep addressed dates that held no
 * rows and skipped ones that did. Computing this in UTC in TypeScript removes
 * the ambiguity rather than configuring around it.
 */
function datesPresent(repos: Repositories): string[] {
  const range = repos.snapshots.timeRange();
  if (!range) return [];

  const dates: string[] = [];
  for (
    let ms = Date.parse(`${utcDate(range.firstMs)}T00:00:00Z`);
    ms <= range.lastMs;
    ms += MS_PER_DAY
  ) {
    dates.push(utcDate(ms));
  }
  return dates;
}
