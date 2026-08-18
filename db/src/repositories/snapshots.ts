import type { FeedType, RawSnapshot } from "@njt/shared";
import type { Database } from "../database";

interface SnapshotRow {
  id: number;
  feed_type: string;
  fetched_at_ms: number;
  raw_bytes: Uint8Array;
}

export class RawSnapshotRepository {
  constructor(private readonly db: Database) {}

  insert(snapshot: RawSnapshot): number {
    const result = this.db
      .prepare(
        "INSERT INTO raw_snapshots (feed_type, fetched_at_ms, raw_bytes) VALUES (:t, :ms, :b)",
      )
      .run({ t: snapshot.feedType, ms: snapshot.fetchedAtMs, b: snapshot.rawBytes });
    return Number(result.lastInsertRowid);
  }

  latest(feedType: FeedType): RawSnapshot | null {
    const row = this.db.get<SnapshotRow>(
      "SELECT * FROM raw_snapshots WHERE feed_type = :t ORDER BY fetched_at_ms DESC LIMIT 1",
      { t: feedType },
    );
    if (!row) return null;
    return { id: row.id, feedType: row.feed_type as FeedType, fetchedAtMs: row.fetched_at_ms, rawBytes: row.raw_bytes };
  }

  /**
   * Paged by `id`, which is chronological, so a replay sees polls in arrival
   * order. Blobs are ~18 KB each (~3 GB total) — callers must page, not select
   * the range; the archive does not fit in memory on the deployed machine.
   */
  pageByTime(
    feedType: FeedType,
    fromMs: number,
    toMs: number,
    afterId: number,
    limit: number,
  ): RawSnapshot[] {
    const rows = this.db.all<SnapshotRow>(
      /* sql */ `
        SELECT id, feed_type, fetched_at_ms, raw_bytes
        FROM raw_snapshots
        WHERE feed_type = :t AND fetched_at_ms BETWEEN :from AND :to AND id > :after
        ORDER BY id
        LIMIT :lim
      `,
      { t: feedType, from: fromMs, to: toMs, after: afterId, lim: limit },
    );
    return rows.map((r) => ({
      id: r.id,
      feedType: r.feed_type as FeedType,
      fetchedAtMs: r.fetched_at_ms,
      rawBytes: r.raw_bytes,
    }));
  }

  /**
   * For walking the whole archive. {@link pageByTime}'s `fetched_at_ms` range
   * sends SQLite to the time index and makes it sort into a temp B-tree for
   * `ORDER BY id` — quadratic over the archive. On `(feed_type, id)` this is an
   * ordered index walk, so each page costs the page.
   */
  pageById(feedType: FeedType, afterId: number, limit: number): RawSnapshot[] {
    const rows = this.db.all<SnapshotRow>(
      /* sql */ `
        SELECT id, feed_type, fetched_at_ms, raw_bytes
        FROM raw_snapshots
        WHERE feed_type = :t AND id > :after
        ORDER BY id
        LIMIT :lim
      `,
      { t: feedType, after: afterId, lim: limit },
    );
    return rows.map((r) => ({
      id: r.id,
      feedType: r.feed_type as FeedType,
      fetchedAtMs: r.fetched_at_ms,
      rawBytes: r.raw_bytes,
    }));
  }

  countByTime(feedType: FeedType, fromMs: number, toMs: number): number {
    return (
      this.db.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM raw_snapshots WHERE feed_type = :t AND fetched_at_ms BETWEEN :from AND :to",
        { t: feedType, from: fromMs, to: toMs },
      )?.c ?? 0
    );
  }

  extent(feedType: FeedType): { firstMs: number; lastMs: number } | null {
    const row = this.db.get<{ firstMs: number | null; lastMs: number | null }>(
      "SELECT MIN(fetched_at_ms) AS firstMs, MAX(fetched_at_ms) AS lastMs FROM raw_snapshots WHERE feed_type = :t",
      { t: feedType },
    );
    return row?.firstMs && row.lastMs ? { firstMs: row.firstMs, lastMs: row.lastMs } : null;
  }

  timeRange(): { firstMs: number; lastMs: number } | null {
    const row = this.db.get<{ firstMs: number | null; lastMs: number | null }>(
      "SELECT MIN(fetched_at_ms) AS firstMs, MAX(fetched_at_ms) AS lastMs FROM raw_snapshots",
    );
    return row?.firstMs != null && row.lastMs != null
      ? { firstMs: row.firstMs, lastMs: row.lastMs }
      : null;
  }

  /**
   * A tool that opens the file directly may not see rows still in `-wal`, so the
   * archive sweep must checkpoint before it exports-then-deletes; otherwise it
   * writes a partial day and deletes a whole one. NJT serves no history to refetch.
   */
  checkpointWal(): void {
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
  }

  /**
   * Only closed windows are safe to sweep: a partial one gains rows from the
   * running pipeline after it is written, and the second write would not cover
   * what the first deleted.
   */
  dayExtent(dayStartMs: number, dayEndMs: number): { rows: number } {
    return {
      rows:
        this.db.get<{ c: number }>(
          "SELECT COUNT(*) AS c FROM raw_snapshots WHERE fetched_at_ms >= :from AND fetched_at_ms < :to",
          { from: dayStartMs, to: dayEndMs },
        )?.c ?? 0,
    };
  }

  /**
   * Batched because the pipeline is writing concurrently: one statement removing
   * a day's ~5,700 blobs holds the write lock long enough to stall a poll, and a
   * stalled poll loses data that cannot be refetched.
   */
  deleteDay(
    dayStartMs: number,
    dayEndMs: number,
    options: { batchSize?: number; betweenBatches?: () => void } = {},
  ): number {
    const batchSize = options.batchSize ?? 500;
    let deleted = 0;

    for (;;) {
      const before = this.dayExtent(dayStartMs, dayEndMs).rows;
      if (before === 0) break;

      this.db.run(
        `DELETE FROM raw_snapshots WHERE id IN (
           SELECT id FROM raw_snapshots
           WHERE fetched_at_ms >= :from AND fetched_at_ms < :to
           LIMIT :limit
         )`,
        { from: dayStartMs, to: dayEndMs, limit: batchSize },
      );

      const after = this.dayExtent(dayStartMs, dayEndMs).rows;
      deleted += before - after;
      if (after === before) break; // nothing removed: stop rather than spin
      options.betweenBatches?.();
    }
    return deleted;
  }

  count(feedType?: FeedType): number {
    const sql = feedType
      ? "SELECT COUNT(*) AS c FROM raw_snapshots WHERE feed_type = :t"
      : "SELECT COUNT(*) AS c FROM raw_snapshots";
    return this.db.get<{ c: number }>(sql, feedType ? { t: feedType } : {})?.c ?? 0;
  }
}
