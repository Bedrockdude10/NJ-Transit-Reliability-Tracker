import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "@njt/db";
import { describe, expect, it } from "vitest";
import { exportedFields, partitionKey, selectList, sqliteColumn } from "../src/archive/export-events";

/**
 * The export projects SQLite onto the contract the Python repo generates from.
 *
 * The column list used to be maintained by hand beside the schema, and the test
 * for it restated the very mapping it was checking. Now both are derived from
 * `contract/v1/trip-stop-event.schema.json`, so agreement is structural — what is
 * left worth testing is the derivation itself, against the real table.
 */

const SCHEMA = JSON.parse(
  readFileSync(resolve(__dirname, "../../contract/v1/trip-stop-event.schema.json"), "utf8"),
) as { properties: Record<string, { type?: string; anyOf?: { type?: string }[] }>; required: string[] };

/** Column names of the real table, from the migrations. */
function liveColumns(): Set<string> {
  const db = openDatabase();
  try {
    return new Set(
      db
        .all<{ name: string }>("SELECT name FROM pragma_table_info('trip_stop_events')")
        .map((row) => row.name),
    );
  } finally {
    db.close();
  }
}

describe("the projection reaches the real table", () => {
  it("derives a column that exists for every contract field", () => {
    // The failure this prevents: a contract field whose derived column is absent
    // makes the whole export fail at runtime, on the server, at 3am.
    const columns = liveColumns();
    const unmatched = exportedFields().filter((field) => !columns.has(sqliteColumn(field)));
    expect(unmatched).toEqual([]);
  });

  it("covers the table completely, so no column is silently dropped", () => {
    expect(exportedFields().map(sqliteColumn).sort()).toEqual([...liveColumns()].sort());
  });

  it("converts the repo's naming convention", () => {
    expect(sqliteColumn("ingestedAtMs")).toBe("ingested_at_ms");
    expect(sqliteColumn("tripId")).toBe("trip_id");
    expect(sqliteColumn("direction")).toBe("direction");
  });
});

describe("the projection matches the contract", () => {
  it("emits exactly the contract's fields", () => {
    // True by construction now; asserted so a change to the derivation shows up.
    expect(exportedFields().sort()).toEqual(Object.keys(SCHEMA.properties).sort());
  });

  it("aliases to contract names, not SQLite names", () => {
    expect(selectList()).toContain('trip_id AS "tripId"');
    expect(selectList()).not.toContain('AS "trip_id"');
  });

  it("casts exactly the fields the contract calls boolean", () => {
    // SQLite stores 0/1; without the cast every row fails strict validation.
    const declared = Object.entries(SCHEMA.properties)
      .filter(([, spec]) => [spec, ...(spec.anyOf ?? [])].some((s) => s.type === "boolean"))
      .map(([field]) => field);
    const list = selectList();

    for (const field of declared) {
      expect(list).toContain(`CAST(${sqliteColumn(field)} AS BOOLEAN) AS "${field}"`);
    }
    expect(list.match(/CAST\(/g) ?? []).toHaveLength(declared.length);
  });
});

describe("partitioning", () => {
  it("writes one hive-partitioned object per service date", () => {
    // `service_date=` lets duckdb, polars and pyarrow skip whole days from the
    // path without opening a file.
    expect(partitionKey("events", "2026-08-13")).toBe("events/service_date=2026-08-13/events.parquet");
  });

  it("is stable, so re-exporting a day replaces it", () => {
    expect(partitionKey("events", "2026-08-13")).toBe(partitionKey("events", "2026-08-13"));
  });

  it("tolerates a trailing slash on the prefix", () => {
    expect(partitionKey("events/", "2026-08-13")).toBe(partitionKey("events", "2026-08-13"));
  });
});
