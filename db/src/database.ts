import { DatabaseSync, type StatementSync } from "node:sqlite";
import { MIGRATIONS } from "./schema";

export type SqlParams = Record<string, string | number | bigint | null | Uint8Array>;

export class Database {
  readonly handle: DatabaseSync;

  /**
   * The API and the pipeline both open the database and run migrations on boot;
   * the loser must outwait the winner's DDL. Adding an index over a 3 GB table
   * took far longer than the 5 s default, so the loser died "database is locked".
   */
  private static readonly BUSY_TIMEOUT_MS = 120_000;

  /** @param path filesystem path, or `:memory:` (default) for an ephemeral db. */
  constructor(path = ":memory:") {
    this.handle = new DatabaseSync(path);
    this.handle.exec("PRAGMA journal_mode = WAL;");
    this.handle.exec("PRAGMA foreign_keys = ON;");
    this.handle.exec(`PRAGMA busy_timeout = ${Database.BUSY_TIMEOUT_MS};`);
    this.migrate();
  }

  prepare(sql: string): StatementSync {
    return this.handle.prepare(sql);
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  all<T>(sql: string, params: SqlParams = {}): T[] {
    return this.handle.prepare(sql).all(params) as unknown as T[];
  }

  get<T>(sql: string, params: SqlParams = {}): T | undefined {
    return this.handle.prepare(sql).get(params) as unknown as T | undefined;
  }

  run(sql: string, params: SqlParams = {}): void {
    this.handle.prepare(sql).run(params);
  }

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

/** Opens and migrates. */
export function openDatabase(path?: string): Database {
  return new Database(path);
}
