import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Repositories } from "@njt/db";
import { FEED_TYPES, type FeedType } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import type { ObjectStore } from "./export-events";

/**
 * Move raw snapshots out of SQLite and into object storage, one blob per object.
 *
 * `raw_snapshots` is ~3.7 GB of the 3.8 GB database and grows 130 MB/day, which
 * fills the volume and makes every backup expensive. The blobs are opaque
 * protobuf payloads kept so parsing can be re-run over history; nothing queries
 * them analytically. So this copies bytes — it does not need a query engine, a
 * columnar format, or a schema.
 *
 * That distinction is the whole reason this exists. The first version exported
 * hourly Parquet through DuckDB and was OOM-killed in production: DuckDB with its
 * sqlite/httpfs/aws extensions costs ~211 MB before reading a row, and peaked at
 * 444 MiB on a machine with 470 MB total, ~280 MB of it already held by the API
 * and the pipeline. The cost was fixed overhead, not data, so no amount of
 * chunking would have helped. Streaming pages to `PutObject` runs in a few MB and
 * can therefore run *often*, which is what actually keeps the volume flat.
 *
 * Two properties matter more than speed, because this deletes the one thing in
 * the system that cannot be re-fetched — NJT serves no history.
 *
 * **Whole closed hours only.** The pipeline only ever appends at "now", so an
 * hour that has passed cannot gain rows. A partially-copied hour could.
 *
 * **The store verifies the bytes, not us.** Every upload carries `Content-MD5`,
 * so R2 rehashes the body it received and rejects a mismatch rather than storing
 * a corrupted object. The returned ETag is then checked against the same digest.
 * Nothing is deleted until every row in the hour has been confirmed this way.
 */

const MS_PER_HOUR = 3_600_000;

/**
 * What one run needs, measured on the production image against real snapshots:
 * 128 MB to move an hour, 132 MB to move three, plus ~10% margin. Most of it is
 * fixed — Node and the S3 client — so the number barely moves with the workload.
 *
 * Kept close to the measurement on purpose. The machine has 148–185 MB free
 * depending on what else is happening, so an over-generous figure here does not
 * make anything safer; it just refuses runs that would have succeeded.
 */
const REQUIRED_MEMORY_MB = 145;

/**
 * Allocatable memory in MB, from `/proc/meminfo`, or null where that is not the
 * kernel's own answer.
 *
 * `MemAvailable` specifically, not `MemFree`: it is the kernel's estimate of what
 * a new process can get without swapping, which is the question being asked.
 * `os.freemem()` was tried first and is not that — on macOS it counts free pages
 * and reported 71 MB on a 64 GB machine.
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
 * Whether there is room to run.
 *
 * This shares a 512 MB machine with the API and the pipeline. Refusing in the
 * first second, with the numbers, beats being OOM-killed partway — which is safe
 * here (nothing is deleted before it is confirmed stored) but reports itself only
 * as exit code 137. The scheduled run simply tries again an hour later.
 */
export function insufficientMemory(availableMb: number | null): string | null {
  if (availableMb === null || availableMb >= REQUIRED_MEMORY_MB) return null;
  return (
    `not enough memory to copy: need ~${REQUIRED_MEMORY_MB} MB, ${availableMb} MB available. ` +
    `Retrying next run, or give the machine more memory.`
  );
}

/** Rows held in memory at once: ~32 KB each, so a page is ~0.8 MB. */
const PAGE_SIZE = 25;

/**
 * Uploads in flight.
 *
 * Four rather than more because the constraint here is memory, not throughput:
 * each in-flight request holds its body plus the client's own per-request state,
 * and this runs beside the API on a machine with ~150 MB to spare. Even at four,
 * an hour of snapshots moves in a few seconds.
 */
const CONCURRENCY = 4;

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
  client?: Pick<S3Client, "send">;
  log?: Logger;
}

export interface CopiedHour {
  hourStartMs: number;
  objects: number;
  bytes: number;
  deleted: number;
}

/**
 * Object key for one snapshot.
 *
 * Everything needed to restore the row is in the key — feed type, instant and id
 * — so a rebuild needs no side table, and `date=`/`hour=` are hive-style so the
 * usual tools can list a day without walking the bucket.
 */
export function snapshotKey(prefix: string, snapshot: {
  feedType: string;
  fetchedAtMs: number;
  id?: number;
}): string {
  const iso = new Date(snapshot.fetchedAtMs).toISOString();
  const date = iso.slice(0, 10);
  const hour = iso.slice(11, 13);
  return `${prefix.replace(/\/+$/, "")}/date=${date}/hour=${hour}/${snapshot.feedType}/${snapshot.fetchedAtMs}-${snapshot.id}.pb`;
}

/** The UTC hour an instant falls in, as epoch ms. */
export function hourStart(ms: number): number {
  return Math.floor(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

/**
 * Which whole UTC hours are old enough to copy, oldest first.
 *
 * The current hour is never included however small the window: it is still being
 * written to.
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

/** Base64 MD5 for `Content-MD5`, and hex for comparing against the returned ETag. */
function digest(bytes: Uint8Array): { base64: string; hex: string } {
  const hash = createHash("md5").update(bytes).digest();
  return { base64: hash.toString("base64"), hex: hash.toString("hex") };
}

/**
 * Run `work` over `items`, at most {@link CONCURRENCY} at a time.
 *
 * A plain `Promise.all` over an hour would open hundreds of sockets at once on a
 * shared-cpu machine; awaiting each in turn would take an hour of round trips to
 * move an hour of data.
 */
async function inParallel<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  });
  await Promise.all(workers);
}

export function createClient(store: ObjectStore): S3Client {
  return new S3Client({
    region: store.region,
    endpoint: `${store.useSsl === false ? "http" : "https"}://${store.endpoint}`,
    credentials: { accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey },
    // R2 and MinIO both serve path-style; virtual-host style would need per-bucket DNS.
    forcePathStyle: true,
  });
}

export async function copySnapshots(options: CopyOptions): Promise<CopiedHour[]> {
  const { repos, store, olderThanHours } = options;
  const prefix = options.prefix ?? "snapshots";
  const now = options.now ?? Date.now;
  const log = options.log;
  const client = options.client ?? createClient(store);
  const deleteAfterCopy = options.deleteAfterCopy ?? true;

  const shortfall = insufficientMemory((options.availableMemoryMb ?? availableMemoryMb)());
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
    // The repository is authoritative — it reads through SQLite, so it sees rows
    // still in the WAL — and its count is what the copy has to match.
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
          const { base64, hex } = digest(snapshot.rawBytes);
          const response = await client.send(
            new PutObjectCommand({
              Bucket: store.bucket,
              Key: snapshotKey(prefix, { ...snapshot, id: snapshot.id }),
              Body: snapshot.rawBytes,
              // The store rehashes the body and rejects a mismatch, so a
              // truncated or corrupted upload cannot be stored and then deleted
              // from the only other copy.
              ContentMD5: base64,
              ContentType: "application/x-protobuf",
            }),
          );
          const etag = response.ETag?.replace(/"/g, "");
          if (etag && etag !== hex) {
            throw new Error(
              `object storage returned a different digest for ${snapshot.id}: sent ${hex}, stored ${etag} — nothing deleted`,
            );
          }
          bytes += snapshot.rawBytes.byteLength;
          objects += 1;
        });

        afterId = page[page.length - 1]!.id ?? afterId;
      }
    }

    // Every row SQLite holds for this hour is verifiably in object storage. An
    // hour the copy could not fully account for is an error, never something to
    // pass over: the gap would be silent and permanent.
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
