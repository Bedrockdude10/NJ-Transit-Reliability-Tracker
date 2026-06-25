import { DatabaseSync, type StatementSync } from "node:sqlite";
import { MIGRATIONS } from "./schema";

/** Values bindable to a named SQL parameter. */
export type SqlParams = Record<string, string | number | bigint | null | Uint8Array>;

/**
 * Thin wrapper around the built-in `node:sqlite` synchronous driver. Keeping
 * the surface small (prepare / exec / transaction) means a future Postgres
 * adapter only has to satisfy this shape, and repositories never touch the
 * driver directly.
 */
export class Database {
  readonly handle: DatabaseSync;

  /** @param path filesystem path, or `:memory:` (default) for an ephemeral db. */
  constructor(path = ":memory:") {
    this.handle = new DatabaseSync(path);
    this.handle.exec("PRAGMA journal_mode = WAL;");
    this.handle.exec("PRAGMA foreign_keys = ON;");
    this.handle.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  prepare(sql: string): StatementSync {
    return this.handle.prepare(sql);
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  /**
   * Typed query helpers. SQLite returns loosely-typed row objects; these cast
   * to the caller's row shape at the single boundary, so repositories stay
   * free of `as unknown as` noise.
   */
  all<T>(sql: string, params: SqlParams = {}): T[] {
    return this.handle.prepare(sql).all(params) as unknown as T[];
  }

  get<T>(sql: string, params: SqlParams = {}): T | undefined {
    return this.handle.prepare(sql).get(params) as unknown as T | undefined;
  }

  run(sql: string, params: SqlParams = {}): void {
    this.handle.prepare(sql).run(params);
  }

  /** Run `fn` inside a transaction, rolling back on any thrown error. */
  transaction<T>(fn: () => T): T {
    this.handle.exec("BEGIN");
    try {
      const result = fn();
      this.handle.exec("COMMIT");
      return result;
    } catch (error) {
      this.handle.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.handle.close();
  }

  /** Apply any migrations not yet recorded in `schema_migrations`. */
  private migrate(): void {
    this.handle.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at_ms INTEGER NOT NULL)",
    );
    const applied = new Set(
      this.handle
        .prepare("SELECT id FROM schema_migrations")
        .all()
        .map((row) => (row as { id: string }).id),
    );
    const record = this.handle.prepare(
      "INSERT INTO schema_migrations (id, applied_at_ms) VALUES (:id, :ms)",
    );
    this.transaction(() => {
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.id)) continue;
        this.handle.exec(migration.up);
        record.run({ id: migration.id, ms: Date.now() });
      }
    });
  }
}

/** Open a database, applying migrations. */
export function openDatabase(path?: string): Database {
  return new Database(path);
}
