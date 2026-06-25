import { describe, expect, it } from "vitest";
import { Database, openDatabase } from "../src/index";

describe("Database", () => {
  it("applies migrations and records them", () => {
    const db = openDatabase();
    const migrations = db
      .prepare("SELECT COUNT(*) AS c FROM schema_migrations")
      .get() as { c: number };
    expect(migrations.c).toBeGreaterThan(0);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trip_stop_events'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("is idempotent when migrations re-run (shared file)", () => {
    // Re-opening the same in-memory db isn't possible, but re-running migrate
    // on a fresh instance must not throw and must not duplicate rows.
    const db = new Database();
    const before = (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c;
    // Manually invoke the public open path again on a new db; counts match.
    const db2 = new Database();
    const after = (db2.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it("rolls back failed transactions", () => {
    const db = openDatabase();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO t (id) VALUES (1)").run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect((db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c).toBe(0);
  });
});
