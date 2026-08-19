import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Database, type Repositories } from "../src";

/**
 * Paging the archive by id had no index to satisfy its `ORDER BY`, so SQLite
 * sorted every matching row into a temp B-tree to return 100 of them —
 * quadratic in the size of the archive. Over a day's data it was free; over
 * 85k polls it turned a minutes-long export into hours.
 *
 * Row-count assertions would never have caught that: the results were correct,
 * only the plan was wrong. So this asserts the plan.
 */
describe("archive paging uses an ordered index walk", () => {
  let repos: Repositories;
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    repos = createRepositories(db);
    for (let i = 0; i < 50; i++) {
      repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: 1_000 + i, rawBytes: new Uint8Array([i]) });
    }
  });

  const plan = (sql: string, params: Record<string, unknown>) =>
    db
      .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params as never)
      .map((r) => r.detail)
      .join(" | ");

  it("pages by id without sorting the archive", () => {
    const detail = plan(
      "SELECT id FROM raw_snapshots WHERE feed_type = :t AND id > :after ORDER BY id LIMIT :lim",
      { t: "TripUpdates", after: 0, lim: 10 },
    );
    expect(detail).toContain("idx_snapshots_feed_id");
    // The whole point: no temp B-tree, so a page costs the page.
    expect(detail).not.toContain("TEMP B-TREE");
  });

  it("returns pages in id order and resumes from the cursor", () => {
    const first = repos.snapshots.pageById("TripUpdates", 0, 10);
    expect(first).toHaveLength(10);
    expect(first.map((s) => s.id)).toEqual([...first.map((s) => s.id)].sort((a, b) => (a ?? 0) - (b ?? 0)));

    const last = first.at(-1);
    if (last === undefined || last.id === undefined) throw new Error("expected a stored page with ids");
    const next = repos.snapshots.pageById("TripUpdates", last.id, 10);
    expect(next[0]?.id).toBeGreaterThan(last.id);
  });

  it("walks the whole archive exactly once", () => {
    const seen = new Set<number>();
    let after = 0;
    for (;;) {
      const page = repos.snapshots.pageById("TripUpdates", after, 7);
      if (page.length === 0) break;
      for (const s of page) {
        if (s.id === undefined) throw new Error("snapshots carry an id");
        seen.add(s.id);
      }
      const last = page.at(-1);
      if (last === undefined || last.id === undefined) throw new Error("page has no id");
      after = last.id;
    }
    expect(seen.size).toBe(50);
  });

  it("keeps feeds separate", () => {
    repos.snapshots.insert({ feedType: "VehiclePositions", fetchedAtMs: 5, rawBytes: new Uint8Array() });
    expect(repos.snapshots.pageById("VehiclePositions", 0, 10)).toHaveLength(1);
  });
});
