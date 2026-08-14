import type { FeedType, RawSnapshot } from "@njt/shared";
import type { Database } from "../database";

interface SnapshotRow {
  id: number;
  feed_type: string;
  fetched_at_ms: number;
  raw_bytes: Uint8Array;
}

/**
 * Append-only archive of raw GTFS-RT protobuf payloads, retained indefinitely
 * so parsing logic can be re-run over history (PRD: "enables reprocessing").
 */
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
   * A page of snapshots in ingest order, for replaying the archive.
   *
   * Paged by `id` rather than offset: ids are assigned on insert so they are
   * already chronological, which both gives a stable resumable cursor and
   * replays polls in the order they arrived — the order that makes
   * last-write-wins reproduce the live pipeline's final state.
   *
   * The blobs are large (~18 KB each, ~3 GB in total), so callers must page
   * rather than select the range: holding the archive in memory is not an
   * option on the deployed machine.
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
   * A page of snapshots by id alone, for walking the whole archive.
   *
   * {@link pageByTime} adds a `fetched_at_ms` range, which sends SQLite to the
   * time index and leaves it sorting every matching row into a temp B-tree to
   * satisfy `ORDER BY id`. Over one day that is free; over the whole archive it
   * is quadratic. Keyed on `(feed_type, id)` this is an ordered index walk, so
   * each page costs the page, not the archive.
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

  /** How many snapshots a replay of this window will have to decode. */
  countByTime(feedType: FeedType, fromMs: number, toMs: number): number {
    return (
      this.db.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM raw_snapshots WHERE feed_type = :t AND fetched_at_ms BETWEEN :from AND :to",
        { t: feedType, from: fromMs, to: toMs },
      )?.c ?? 0
    );
  }

  /** Earliest and latest snapshot instants held, for reporting archive extent. */
  extent(feedType: FeedType): { firstMs: number; lastMs: number } | null {
    const row = this.db.get<{ firstMs: number | null; lastMs: number | null }>(
      "SELECT MIN(fetched_at_ms) AS firstMs, MAX(fetched_at_ms) AS lastMs FROM raw_snapshots WHERE feed_type = :t",
      { t: feedType },
    );
    return row?.firstMs && row.lastMs ? { firstMs: row.firstMs, lastMs: row.lastMs } : null;
  }

  /** Earliest and latest snapshot instants across all feeds, or null if empty. */
  timeRange(): { firstMs: number; lastMs: number } | null {
    const row = this.db.get<{ firstMs: number | null; lastMs: number | null }>(
      "SELECT MIN(fetched_at_ms) AS firstMs, MAX(fetched_at_ms) AS lastMs FROM raw_snapshots",
    );
    return row?.firstMs != null && row.lastMs != null
      ? { firstMs: row.firstMs, lastMs: row.lastMs }
      : null;
  }

  /**
   * Flush the WAL into the main database file.
   *
   * Anything read by a tool that opens the file directly — DuckDB's SQLite
   * scanner, for one — may not see rows still living in `-wal`. The archive
   * sweep exports through DuckDB and then deletes through this repository, so
   * without a checkpoint first it could write a partial day and delete a whole
   * one. That is unrecoverable: NJT serves no history.
   */
  checkpointWal(): void {
    this.db.exec("PRAGMA wal_checkpoint(FULL)");
  }

  /**
   * Snapshot instants bounding a UTC day, and how many rows it holds.
   *
   * The archive sweep works a whole UTC day at a time: a partial day could be
   * written to object storage, then gain more rows from the still-running
   * pipeline, and the second write would not cover what the first deleted.
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
   * Delete a UTC day's snapshots, in batches, returning how many went.
   *
   * Batched because this runs against a live database the pipeline is writing
   * to: one statement removing a day's 5,700 blobs holds the write lock long
   * enough to stall a poll, and a stalled poll loses data that cannot be
   * refetched. `betweenBatches` lets the caller yield between them.
   *
   * Note this frees pages *inside* the file for reuse rather than shrinking it.
   * That is the intent — it stops the file growing, which is what the volume
   * ceiling actually requires, without the full rewrite a VACUUM would cost.
   */
  deleteDay(
    dayStartMs: number,
    dayEndMs: number,
    options: { batchSize?: number; betweenBatches?: () => void } = {},
  ): number {
    const batchSize = options.batchSize ?? 500;
    let deleted = 0;

    // A subquery with LIMIT rather than an assembled `IN (?, ?, …)` list: all
    // parameters stay named, matching the driver, and the statement is constant
    // so SQLite can reuse its plan across batches.
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
