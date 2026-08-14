import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_COLUMNS, exportedFields, partitionKey, selectList } from "../src/archive/export-events";

/**
 * The export's column list is the producer half of the object-storage contract.
 * The Python repo generates its models from `contract/v1/*.schema.json`, so a
 * field added to the schema and forgotten here would simply be absent from every
 * Parquet file — and absent columns read as nulls, which a model happily trains
 * on. These tests are what turn that into a build failure.
 */

const SCHEMA = JSON.parse(
  readFileSync(resolve(__dirname, "../../contract/v1/trip-stop-event.schema.json"), "utf8"),
) as { properties: Record<string, unknown>; required: string[] };

describe("the export matches the published contract", () => {
  it("emits exactly the contract's fields, no more and no fewer", () => {
    expect(exportedFields().sort()).toEqual(Object.keys(SCHEMA.properties).sort());
  });

  it("emits every required field", () => {
    expect(exportedFields()).toEqual(expect.arrayContaining(SCHEMA.required));
  });

  it("names them as the contract does, not as SQLite does", () => {
    // SQLite is snake_case; the contract is camelCase. Exporting raw column
    // names would fail validation on every row.
    expect(exportedFields()).toContain("tripId");
    expect(exportedFields()).not.toContain("trip_id");
  });
});

describe("type conversions", () => {
  it("casts SQLite's 0/1 booleans to real booleans", () => {
    // The contract says boolean; without the cast these export as integers and
    // pydantic rejects every row under strict validation.
    const booleanFields = EVENT_COLUMNS.filter((c) => c.length === 3).map(([, alias]) => alias);
    expect(booleanFields).toEqual(["stopSkipped", "tripCancelled"]);
    for (const field of booleanFields) {
      expect(selectList()).toContain(`CAST(${field === "stopSkipped" ? "stop_skipped" : "trip_cancelled"} AS BOOLEAN) AS "${field}"`);
    }
  });

  it("agrees with the schema about which fields are boolean", () => {
    const fromSchema = Object.entries(SCHEMA.properties)
      .filter(([, spec]) => (spec as { type?: string }).type === "boolean")
      .map(([name]) => name)
      .sort();
    const fromExport = EVENT_COLUMNS.filter((c) => c.length === 3).map(([, alias]) => alias).sort();
    expect(fromExport).toEqual(fromSchema);
  });

  it("leaves other columns unwrapped", () => {
    expect(selectList()).toContain('trip_id AS "tripId"');
  });
});

describe("partitioning", () => {
  it("writes one hive-partitioned object per service date", () => {
    // `service_date=` lets duckdb, polars and pyarrow all skip whole days from
    // the path without opening a file.
    expect(partitionKey("events", "2026-08-13")).toBe("events/service_date=2026-08-13/events.parquet");
  });

  it("is stable, so re-exporting a day replaces it", () => {
    // Appending instead of replacing would double-count a backfilled day.
    expect(partitionKey("events", "2026-08-13")).toBe(partitionKey("events", "2026-08-13"));
  });

  it("tolerates a trailing slash on the prefix", () => {
    expect(partitionKey("events/", "2026-08-13")).toBe(partitionKey("events", "2026-08-13"));
  });
});
