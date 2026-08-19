import type { Repositories } from "@njt/db";
import { DATASETS, FEED_TYPES, type FeedType } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import { availableMemoryMb, insufficientMemory } from "./machine";
import { createClient, type ObjectStore, type ObjectWriter, putVerified } from "./object-store";

/**
 * Move raw snapshots out of SQLite and into object storage, one blob per object.
 * See DEPLOY.md → Draining the raw archive.
 *
 * Whole closed hours only: the pipeline appends at "now", so a past hour cannot
 * gain rows where a partially-copied one could.
 */

const MS_PER_HOUR = 3_600_000;

/**
 * Measured on the production image at the concurrency below (128 MB at four).
 * Kept close to the measurement: the machine has 148–185 MB free, so an
 * over-generous figure just refuses runs that would have succeeded.
 */
const REQUIRED_MEMORY_MB = 155;

/** Rows held in memory at once: ~32 KB each, so a page is ~0.8 MB. */
const PAGE_SIZE = 25;

/** Uploads in flight. Bounded by memory, not throughput — each holds its body. */
const CONCURRENCY = 8;

export interface CopyOptions {
  repos: Repositories;
  store: ObjectStore;
  /** Hours must be at least this old before being copied. */
  olderThanHours: number;
  /** Stop after this many hours in one run. Unbounded by default. */
  maxHours?: number;
  /** Delete rows once their objects are confirmed. On by default. */
  deleteAfterCopy?: boolean;
  prefix?: string;
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests. Allocatable memory in MB, or null if unknown. */
  availableMemoryMb?: () => number | null;
  client?: ObjectWriter;
  log?: Logger;
}

export interface CopiedHour {
  hourStartMs: number;
  objects: number;
  bytes: number;
  deleted: number;
}

/**
 * Object key for one snapshot. Everything needed to restore the row is in the key,
 * so a rebuild needs no side table; `date=`/`hour=` are hive-style.
 */
export function snapshotKey(
  prefix: string,
  snapshot: { feedType: string; fetchedAtMs: number; id?: number },
): string {
  const iso = new Date(snapshot.fetchedAtMs).toISOString();
  const date = iso.slice(0, 10);
  const hour = iso.slice(11, 13);
  const { partitionBy } = DATASETS.snapshots;
  return `${prefix.replace(/\/+$/, "")}/${partitionBy}=${date}/hour=${hour}/${snapshot.feedType}/${snapshot.fetchedAtMs}-${snapshot.id}.pb`;
}

/** The UTC hour an instant falls in, as epoch ms. */
export function hourStart(ms: number): number {
  return Math.floor(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

/**
 * Which whole UTC hours are old enough to copy, oldest first. The current hour is
 * never included however small the window: it is still being written to.
 */
export function copyableHours(
  range: { firstMs: number; lastMs: number },
  olderThanHours: number,
  nowMs: number,
  limit?: number,
): number[] {
  const cutoff = hourStart(nowMs) - olderThanHours * MS_PER_HOUR;
  const hours: number[] = [];
  for (let ms = hourStart(range.firstMs); ms <= range.lastMs && ms < cutoff; ms += MS_PER_HOUR) {
    hours.push(ms);
    if (limit !== undefined && hours.length >= limit) break;
  }
  return hours;
}

/** Run `work` over `items`, at most {@link CONCURRENCY} at a time. */
async function inParallel<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  });
  await Promise.all(workers);
}

export async function copySnapshots(options: CopyOptions): Promise<CopiedHour[]> {
  const { repos, store, olderThanHours } = options;
  const prefix = options.prefix ?? DATASETS.snapshots.prefix;
  const now = options.now ?? Date.now;
  const log = options.log;
  const client = options.client ?? createClient(store);
  const deleteAfterCopy = options.deleteAfterCopy ?? true;

  const shortfall = insufficientMemory(
    "copy",
    REQUIRED_MEMORY_MB,
    (options.availableMemoryMb ?? availableMemoryMb)(),
  );
  if (shortfall) throw new Error(shortfall);

  const range = repos.snapshots.timeRange();
  if (!range) {
    log?.info("archive is empty; nothing to copy");
    return [];
  }

  const hours = copyableHours(range, olderThanHours, now(), options.maxHours);
  log?.info("copy starting", { hours: hours.length, olderThanHours, prefix });

  const copied: CopiedHour[] = [];
  for (const hourStartMs of hours) {
    const hourEndMs = hourStartMs + MS_PER_HOUR;
    // Reads through SQLite, so it sees rows still in the WAL.
    const expected = repos.snapshots.dayExtent(hourStartMs, hourEndMs).rows;
    if (expected === 0) continue;

    let objects = 0;
    let bytes = 0;
    for (const feedType of FEED_TYPES) {
      let afterId = 0;
      for (;;) {
        // `pageByTime`'s range is inclusive at both ends, so stop one ms short of
        // the next hour rather than copying its first instant twice.
        const page = repos.snapshots.pageByTime(
          feedType as FeedType,
          hourStartMs,
          hourEndMs - 1,
          afterId,
          PAGE_SIZE,
        );
        if (page.length === 0) break;

        await inParallel(page, async (snapshot) => {
          const stored = await putVerified(client, {
            bucket: store.bucket,
            key: snapshotKey(prefix, snapshot),
            body: snapshot.rawBytes,
            contentType: "application/x-protobuf",
          });
          bytes += stored.bytes;
          objects += 1;
        });

        const last = page[page.length - 1];
        if (last) afterId = last.id ?? afterId;
      }
    }

    // An hour the copy cannot fully account for is an error, never something to
    // pass over: NJT serves no history, so the gap would be permanent.
    if (objects !== expected) {
      throw new Error(
        `refusing to delete ${new Date(hourStartMs).toISOString()}: sqlite holds ${expected} rows, ` +
          `${objects} are confirmed in object storage`,
      );
    }

    const deleted = deleteAfterCopy ? repos.snapshots.deleteDay(hourStartMs, hourEndMs) : 0;
    log?.info("hour copied", {
      hour: new Date(hourStartMs).toISOString(),
      objects,
      megabytes: Math.round(bytes / 1_048_576),
      deleted,
    });
    copied.push({ hourStartMs, objects, bytes, deleted });
  }

  log?.info("copy complete", {
    hours: copied.length,
    objects: copied.reduce((total, hour) => total + hour.objects, 0),
    megabytes: Math.round(copied.reduce((total, hour) => total + hour.bytes, 0) / 1_048_576),
  });
  return copied;
}
