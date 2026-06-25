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

  count(feedType?: FeedType): number {
    const sql = feedType
      ? "SELECT COUNT(*) AS c FROM raw_snapshots WHERE feed_type = :t"
      : "SELECT COUNT(*) AS c FROM raw_snapshots";
    return this.db.get<{ c: number }>(sql, feedType ? { t: feedType } : {})?.c ?? 0;
  }
}
