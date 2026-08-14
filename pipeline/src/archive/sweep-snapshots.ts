import { readFileSync } from "node:fs";
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

/** Default DuckDB budget. An hour of snapshots is ~5 MB; this is already ample. */
const DEFAULT_MEMORY_LIMIT_MB = 64;

/**
 * What this process needs before it reads a single row: Node, tsx, the DuckDB
 * library, and its sqlite/httpfs/aws extensions.
 *
 * Measured on the production image, stage by stage: 98 MB once the DuckDB library
 * is loaded, 132 MB with an instance open, 204 MB once the three extensions are
 * loaded, 211 MB with S3 configured and the database attached. It is a fixed cost
 * and it dwarfs the work — which is why a 512 MB machine already running the API
 * and the pipeline (~280 MB) cannot host this at all, whatever the budget.
 */
const PROCESS_OVERHEAD_MB = 215;

/**
 * Allocatable memory in MB, from `/proc/meminfo`, or null where that is not the
 * kernel's own answer.
 *
 * `MemAvailable` specifically, not `MemFree`: it is the kernel's own estimate of
 * what a new process can get without swapping, which is the question being asked.
 * `os.freemem()` was tried first and is not that — on macOS it counts free pages
 * and reported 71 MB on a 64 GB machine, blocking the test suite.
 *
 * Returns null off Linux rather than guessing, and the check is then skipped: a
 * developer machine is not where this needs protecting.
 */
export function parseAvailableMemoryMb(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo);
  return match ? Math.floor(Number(match[1]) / 1024) : null;
}

function availableMemoryMb(): number | null {
  try {
    return parseAvailableMemoryMb(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

/**
 * Whether there is room to run, given DuckDB's budget and what is allocatable.
 *
 * Returns the reason it cannot, or null. The point is to fail in the first second
 * with a sentence explaining what to do, instead of being OOM-killed partway
 * through — which is survivable here (nothing is deleted until a whole day is
 * verified) but reports itself only as exit code 137.
 */
export function insufficientMemory(budgetMb: number, availableMb: number | null): string | null {
  const needMb = budgetMb + PROCESS_OVERHEAD_MB;
  if (availableMb === null || availableMb >= needMb) return null;
  return (
    `not enough memory to sweep: need ~${needMb} MB (${budgetMb} MB for DuckDB ` +
    `plus ~${PROCESS_OVERHEAD_MB} MB for this process), ${availableMb} MB available. ` +
    `Lower --memory-limit, give the machine more memory, or run when it is quieter.`
  );
}

export interface SweepOptions {
  dbPath: string;
  /**
   * Scratch space for DuckDB to spill into, rather than competing for memory with
   * the API and the pipeline. Defaults beside the database, which is the volume
   * with room.
   */
  tempDir?: string;
  repos: Repositories;
  store: ObjectStore;
  /** Days must be at least this old before being swept. */
  olderThanDays: number;
  /**
   * How much memory DuckDB may use, in MB.
   *
   * Small on purpose: with the window pushed into SQLite ({@link windowQuery}) an
   * hour is ~5 MB, and the same work that needed 192 MB before now completes at
   * 32 MB. This is the budget for the *work*; the fixed library cost is
   * {@link PROCESS_OVERHEAD_MB} and is much larger.
   */
  memoryLimitMb?: number;
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
  /** Injected for tests. Allocatable memory in MB, or null if unknown. */
  availableMemoryMb?: () => number | null;
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
 * Hours rather than whole days to keep each object and each read small: ~5 MB
 * rather than ~130 MB. This was originally believed to be what bounded the
 * sweep's memory; it was not — see {@link windowQuery} — but small objects are
 * still worth having, since a failed hour costs an hour of work to redo.
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

/**
 * An integer SQL literal.
 *
 * {@link windowQuery} nests SQL inside SQL, and the inner string cannot carry bind
 * parameters, so its bounds are interpolated. They are always epoch milliseconds
 * computed here — never user input — and this refuses anything that is not a plain
 * integer rather than trusting that to stay true.
 */
export function integerLiteral(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error(`not a safe integer: ${value}`);
  return String(value);
}

/**
 * One time window, read through SQLite's own planner.
 *
 * The obvious form — `ATTACH` the file, then `SELECT … WHERE fetched_at_ms
 * BETWEEN …` — makes DuckDB scan the table and apply the filter itself, so an hour
 * holding 120 rows pulls *every* blob in the table through DuckDB's buffer
 * manager. Memory then scales with the archive rather than the hour: measured, the
 * unit tests' 12 KB table passes at a 64 MB budget while a 126 MB table fails at
 * 128 MB, and production's 3.7 GB table was hopeless at any budget. That is why
 * the first production sweep was OOM-killed, and why chunking by hour did not save
 * it — the chunk was never what determined the cost.
 *
 * `sqlite_query` hands the SQL to SQLite instead, which answers it from
 * `idx_snapshots_feed_time` — a covering index for this predicate — and returns
 * only the matching rows. Measured on the production table: 16 ms to select an
 * hour out of 175,346 rows, and the same window now completes at a 32 MB budget.
 */
export function windowQuery(projection: string, fromMs: number, toMs: number): string {
  const inner =
    `SELECT * FROM raw_snapshots WHERE fetched_at_ms >= ${integerLiteral(fromMs)} ` +
    `AND fetched_at_ms < ${integerLiteral(toMs)} ORDER BY id`;
  return `(SELECT ${projection} FROM sqlite_query('live', ${literal(inner)}))`;
}

/**
 * Column expressions that restore the live table's own types.
 *
 * `sqlite_query` returns every column as VARCHAR — ids, timestamps and blobs
 * alike. Written straight out, the archive would silently become an all-strings
 * copy of itself, and reading the Parquet back fails outright on a blob, since
 * those bytes are not valid UTF-8. Blobs go through `encode`, which is a
 * reinterpretation rather than a conversion (`CAST(… AS BLOB)` demands escaped
 * hex and refuses); the rest are cast back.
 *
 * Derived from the attached table rather than written out here, so adding a column
 * cannot leave the archive with a stale schema. The digest is computed over these
 * same expressions, so what is verified is exactly what is written.
 */
export function typedProjection(columns: readonly { name: string; type: string }[]): string {
  return columns
    .map(({ name, type }) => {
      if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`unexpected column name: ${name}`);
      if (!/^[A-Z0-9 ()]+$/i.test(type)) throw new Error(`unexpected column type: ${type}`);
      const expression = type === "BLOB" ? `encode(${name})` : `CAST(${name} AS ${type})`;
      return `${expression} AS ${name}`;
    })
    .join(", ");
}

async function liveProjection(
  connection: Awaited<ReturnType<DuckDBInstance["connect"]>>,
): Promise<string> {
  const described = await connection.runAndReadAll("DESCRIBE live.raw_snapshots");
  return typedProjection(
    described.getRowObjects().map((row) => ({
      name: String((row as { column_name: unknown }).column_name),
      type: String((row as { column_type: unknown }).column_type),
    })),
  );
}

export async function sweepSnapshots(options: SweepOptions): Promise<SweptDay[]> {
  const { dbPath, repos, store, olderThanDays } = options;
  const prefix = options.prefix ?? "archive";
  const now = options.now ?? Date.now;
  const log = options.log;

  // Checked before opening DuckDB, so a box with no room to spare says so in the
  // first second rather than at whatever point the kernel loses patience.
  const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
  const availableMb = (options.availableMemoryMb ?? availableMemoryMb)();
  const shortfall = insufficientMemory(memoryLimitMb, availableMb);
  if (shortfall) throw new Error(shortfall);
  log?.info("sweep memory plan", { memoryLimitMb, availableMb });

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const swept: SweptDay[] = [];

  try {
    // Budget and thread count are both about fitting alongside the API and the
    // pipeline on a 512 MB machine: a second thread buys nothing on ~5 MB of work
    // per hour and duplicates DuckDB's per-thread buffers.
    // TimeZone pinned to UTC as a matter of hygiene: DuckDB's date functions
    // render timezone-aware values in the session zone, and a whole class of
    // off-by-a-day bug lives there. Nothing below relies on it — dates are
    // derived in TypeScript — but a future query should not have to know that.
    // The temp directory is on the volume: without somewhere to spill this dies
    // with "failed to pin block" partway through a day — measured, on a
    // production-shaped database, before it ever ran anywhere real.
    const tempDir = options.tempDir ?? `${dbPath}.duckdb-tmp`;
    await connection.run(
      `SET memory_limit='${memoryLimitMb}MB'; SET threads=1; SET TimeZone='UTC'; SET temp_directory=${literal(tempDir)};`,
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
      const projection = await liveProjection(connection);

      const hours: SweptHour[] = [];
      try {
        for (let hour = 0; hour < 24; hour++) {
          const fromMs = startMs + hour * MS_PER_HOUR;
          const toMs = fromMs + MS_PER_HOUR;

          const read = await connection.runAndReadAll(
            `SELECT COUNT(*) AS rows, ${DIGEST} AS digest FROM ${windowQuery(projection, fromMs, toMs)}`,
          );
          const row = read.getRowObjects()[0] as { rows: bigint | number; digest: string };
          const rows = Number(row.rows);
          if (rows === 0) continue;

          const uri = `s3://${store.bucket}/${archiveKey(prefix, date, hour)}`;
          await connection.run(
            `COPY (SELECT * FROM ${windowQuery(projection, fromMs, toMs)})
             TO '${uri}' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE)`,
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
