import type { DataGap, FeedHealth } from "@njt/shared";
import type { Database } from "../database";

function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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

  /** Counts are for the UTC day of `nowMs`. */
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
   * Uptime is measured against the collection window, so a gap ending before the
   * window's start is not lost coverage — it is time never claimed.
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

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO pipeline_meta (key, value) VALUES (:k, :v)")
      .run({ k: key, v: value });
  }

  getMeta(key: string): string | null {
    const row = this.db.get<{ value: string }>("SELECT value FROM pipeline_meta WHERE key = :k", { k: key });
    return row?.value ?? null;
  }

  /** First writer wins. */
  ensureCollectionStart(date: string): void {
    if (this.getMeta("collection_start_date") === null) {
      this.setMeta("collection_start_date", date);
    }
  }

  collectionStartDate(): string | null {
    return this.getMeta("collection_start_date");
  }

  /** Returns 100 when there is no collection window yet. */
  uptimePercent(nowMs: number = Date.now(), start: string | null = this.collectionStartDate()): number {
    if (!start) return 100;
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const windowMs = Math.max(nowMs - startMs, 1);
    // Clamp each gap to the window: a gap can straddle the start, and charging
    // its full duration against a shorter window understates uptime badly.
    const lostMs = this.gaps().reduce((sum, g) => {
      const from = Math.max(g.startMs, startMs);
      const to = Math.min(g.endMs, nowMs);
      return sum + Math.max(to - from, 0);
    }, 0);
    return Math.max(0, Math.min(100, (1 - lostMs / windowMs) * 100));
  }
}
