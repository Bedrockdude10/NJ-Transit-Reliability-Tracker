import type { DataGap, FeedHealth } from "@njt/shared";
import type { Database } from "../database";

/** UTC calendar date (YYYY-MM-DD) of an epoch-ms instant — for daily counters. */
function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Tracks the pipeline's operational health: per-feed last success/failure, daily
 * poll and failure counts, known data gaps, API request budgets, and arbitrary
 * meta (e.g. collection start date). Surfaced read-only by the API.
 */
export class HealthRepository {
  constructor(private readonly db: Database) {}

  private incrementDaily(feedType: string, ms: number, polls: number, failures: number): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO ingest_daily_stats (date, feed_type, polls, failures)
        VALUES (:d, :f, :p, :fail)
        ON CONFLICT(date, feed_type) DO UPDATE SET
          polls    = polls + :p,
          failures = failures + :fail
      `,
      )
      .run({ d: utcDateString(ms), f: feedType, p: polls, fail: failures });
  }

  private setFeedTimestamps(feedType: string, successMs: number | null, failureMs: number | null): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO feed_health (feed_type, last_success_at_ms, last_failure_at_ms)
        VALUES (:f, :s, :fa)
        ON CONFLICT(feed_type) DO UPDATE SET
          last_success_at_ms = COALESCE(:s, last_success_at_ms),
          last_failure_at_ms = COALESCE(:fa, last_failure_at_ms)
      `,
      )
      .run({ f: feedType, s: successMs, fa: failureMs });
  }

  recordSuccess(feedType: string, ms: number): void {
    this.setFeedTimestamps(feedType, ms, null);
    this.incrementDaily(feedType, ms, 1, 0);
  }

  recordFailure(feedType: string, ms: number): void {
    this.setFeedTimestamps(feedType, null, ms);
    this.incrementDaily(feedType, ms, 1, 1);
  }

  /** Feed health snapshot, with poll/failure counts for the UTC day of `nowMs`. */
  feedHealth(nowMs: number = Date.now()): FeedHealth[] {
    const today = utcDateString(nowMs);
    return this.db.all<FeedHealth>(
      /* sql */ `
        SELECT fh.feed_type AS feedType,
               fh.last_success_at_ms AS lastSuccessAtMs,
               fh.last_failure_at_ms AS lastFailureAtMs,
               COALESCE(ids.polls, 0) AS pollsToday,
               COALESCE(ids.failures, 0) AS failuresToday
        FROM feed_health fh
        LEFT JOIN ingest_daily_stats ids
          ON ids.feed_type = fh.feed_type AND ids.date = :today
        ORDER BY fh.feed_type
      `,
      { today },
    );
  }

  dailyStats(date: string): { feedType: string; polls: number; failures: number }[] {
    return this.db.all<{ feedType: string; polls: number; failures: number }>(
      "SELECT feed_type AS feedType, polls, failures FROM ingest_daily_stats WHERE date = :d ORDER BY feed_type",
      { d: date },
    );
  }

  recordGap(feedType: string, startMs: number, endMs: number): void {
    this.db
      .prepare("INSERT INTO data_gaps (feed_type, start_ms, end_ms) VALUES (:f, :s, :e)")
      .run({ f: feedType, s: startMs, e: endMs });
  }

  /**
   * Drop gaps that finish at or before `ms`. Uptime is measured against the
   * collection window, so a gap preceding the window's start isn't lost
   * coverage — it's time the project never claimed to cover.
   */
  deleteGapsEndingAtOrBefore(ms: number): number {
    const affected =
      this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM data_gaps WHERE end_ms <= :ms", { ms })?.c ?? 0;
    this.db.run("DELETE FROM data_gaps WHERE end_ms <= :ms", { ms });
    return affected;
  }

  gaps(): DataGap[] {
    return this.db.all<DataGap>(
      "SELECT feed_type AS feedType, start_ms AS startMs, end_ms AS endMs FROM data_gaps ORDER BY start_ms",
    );
  }

  // --- Rate-limit budget ----------------------------------------------------

  incrementBudget(group: string, count: number, ms: number = Date.now()): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO request_budget (date, budget_group, count) VALUES (:d, :g, :c)
        ON CONFLICT(date, budget_group) DO UPDATE SET count = count + :c
      `,
      )
      .run({ d: utcDateString(ms), g: group, c: count });
  }

  budgetUsed(group: string, ms: number = Date.now()): number {
    const row = this.db.get<{ count: number }>(
      "SELECT count FROM request_budget WHERE date = :d AND budget_group = :g",
      { d: utcDateString(ms), g: group },
    );
    return row?.count ?? 0;
  }

  // --- Meta -----------------------------------------------------------------

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO pipeline_meta (key, value) VALUES (:k, :v)")
      .run({ k: key, v: value });
  }

  getMeta(key: string): string | null {
    const row = this.db.get<{ value: string }>("SELECT value FROM pipeline_meta WHERE key = :k", { k: key });
    return row?.value ?? null;
  }

  /** Set the collection start date once (first writer wins). */
  ensureCollectionStart(date: string): void {
    if (this.getMeta("collection_start_date") === null) {
      this.setMeta("collection_start_date", date);
    }
  }

  collectionStartDate(): string | null {
    return this.getMeta("collection_start_date");
  }

  /**
   * Uptime as the fraction of the collection window not lost to recorded gaps.
   * Returns 100 when there is no collection window yet. `start` defaults to
   * {@link collectionStartDate}; callers that already resolved it (e.g. /health)
   * can pass it in to avoid a second lookup.
   */
  uptimePercent(nowMs: number = Date.now(), start: string | null = this.collectionStartDate()): number {
    if (!start) return 100;
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const windowMs = Math.max(nowMs - startMs, 1);
    const lostMs = this.gaps().reduce((sum, g) => sum + Math.max(g.endMs - g.startMs, 0), 0);
    return Math.max(0, Math.min(100, (1 - lostMs / windowMs) * 100));
  }
}
