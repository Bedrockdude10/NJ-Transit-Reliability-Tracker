import { readFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Logger } from "@njt/shared/logger";

/**
 * Publish derived events to object storage as Parquet, one object per service
 * date, for the Python modelling repo to read.
 *
 * DuckDB does the whole job in SQL — attach the SQLite file, `COPY … TO 's3://…'
 * (FORMAT PARQUET)`. Writing Parquet by hand from Node would mean choosing an
 * encoder, mapping types onto Arrow, and streaming row groups: a few hundred
 * lines reimplementing what this already does, and a second place for the column
 * types to disagree with `contract/v1/trip-stop-event.schema.json`.
 *
 * The column list and its aliases are the contract. They are asserted against
 * the generated JSON Schema in `archive.contract.test.ts`, so a field added
 * upstream fails the build here rather than silently missing from every export.
 */

/** Where and how to reach the bucket. */
export interface ObjectStore {
  bucket: string;
  /** S3-compatible endpoint without a scheme, e.g. `abc.r2.cloudflarestorage.com`. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 requires the literal "auto"; MinIO and AWS want a real region. */
  region: string;
  /** MinIO over plain HTTP locally; R2 is always TLS. */
  useSsl?: boolean;
}

export interface ExportOptions {
  dbPath: string;
  store: ObjectStore;
  /** Service dates to publish. Each becomes exactly one object. */
  serviceDates: readonly string[];
  prefix?: string;
  log?: Logger;
}

export interface ExportedPartition {
  serviceDate: string;
  uri: string;
  rows: number;
}

/**
 * The contract, as read at runtime from the schema the Python repo generates
 * from.
 *
 * There was a hand-maintained list of `[sqliteColumn, contractField]` pairs here,
 * with a third tuple element whose *presence* meant "cast to boolean". Two
 * problems: it was a second place the column set could disagree with the
 * contract, and the test asserting they matched had to restate the mapping it was
 * checking. Deriving both from the schema removes the disagreement rather than
 * testing for it.
 */
interface ContractSchema {
  properties: Record<string, { type?: string; anyOf?: { type?: string }[] }>;
}

const SCHEMA_PATH = new URL("../../../contract/v1/trip-stop-event.schema.json", import.meta.url);

function contract(): ContractSchema {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as ContractSchema;
}

/** `ingestedAtMs` → `ingested_at_ms`. The repo's own naming convention. */
export function sqliteColumn(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Fields the contract declares boolean, wherever nullability puts the type. */
function booleanFields(schema: ContractSchema): Set<string> {
  return new Set(
    Object.entries(schema.properties)
      .filter(([, spec]) => [spec, ...(spec.anyOf ?? [])].some((s) => s.type === "boolean"))
      .map(([field]) => field),
  );
}

/** Field names the export produces — every field the contract declares. */
export function exportedFields(): string[] {
  return Object.keys(contract().properties);
}

/**
 * The SELECT list.
 *
 * SQLite stores booleans as 0/1 while the contract says boolean, so those are the
 * one real conversion: without the cast they export as integers and every row
 * fails strict validation on the Python side.
 */
export function selectList(): string {
  const schema = contract();
  const booleans = booleanFields(schema);
  return Object.keys(schema.properties)
    .map((field) => {
      const column = sqliteColumn(field);
      const expression = booleans.has(field) ? `CAST(${column} AS BOOLEAN)` : column;
      return `${expression} AS "${field}"`;
    })
    .join(", ");
}

/**
 * Object key for a service date.
 *
 * Hive-partitioned (`service_date=…`) so DuckDB, polars and pyarrow can all skip
 * whole days from the path without opening a file, and so re-exporting a day
 * replaces it rather than appending a duplicate.
 */
export function partitionKey(prefix: string, serviceDate: string): string {
  return `${prefix.replace(/\/+$/, "")}/service_date=${serviceDate}/events.parquet`;
}

/**
 * A SQL string literal, for the statements that cannot bind parameters.
 *
 * `ATTACH` is DDL and takes no placeholders. Credentials never go through here —
 * see {@link configureStore}.
 */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Configure DuckDB's S3 client.
 *
 * Credentials reach DuckDB through its credential chain, from the environment,
 * rather than interpolated into a `CREATE SECRET` statement. The keys then never
 * appear in a SQL string that could be logged or surfaced in an error.
 */
export async function configureStore(
  connection: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  store: ObjectStore,
): Promise<void> {
  process.env.AWS_ACCESS_KEY_ID = store.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = store.secretAccessKey;
  process.env.AWS_DEFAULT_REGION = store.region;

  await connection.run(
    "INSTALL sqlite; LOAD sqlite; INSTALL httpfs; LOAD httpfs; INSTALL aws; LOAD aws;",
  );
  await connection.run(
    `CREATE OR REPLACE SECRET njt_store (
       TYPE s3,
       PROVIDER credential_chain,
       CHAIN 'env',
       ENDPOINT ${literal(store.endpoint)},
       USE_SSL ${store.useSsl ?? true},
       URL_STYLE 'path'
     )`,
  );
}

/**
 * Export the given service dates. Returns one entry per date actually written.
 *
 * A date with no events is skipped rather than written empty: an empty Parquet
 * object is indistinguishable from a day the pipeline missed, and a model reading
 * it would treat "no trains ran" as fact.
 */
export async function exportEvents(options: ExportOptions): Promise<ExportedPartition[]> {
  const { dbPath, store, serviceDates } = options;
  const prefix = options.prefix ?? "events";
  const log = options.log;

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const written: ExportedPartition[] = [];

  try {
    await configureStore(connection, store);
    await connection.run(`ATTACH ${literal(dbPath)} AS live (TYPE sqlite, READ_ONLY)`);

    for (const serviceDate of serviceDates) {
      const counted = await connection.runAndReadAll(
        "SELECT COUNT(*) AS n FROM live.trip_stop_events WHERE service_date = ?",
        [serviceDate],
      );
      const rows = Number((counted.getRowObjects()[0] as { n: bigint | number }).n);
      if (rows === 0) {
        log?.warn("no events for service date; skipping", { serviceDate });
        continue;
      }

      const uri = `s3://${store.bucket}/${partitionKey(prefix, serviceDate)}`;
      log?.info("exporting service date", { serviceDate, rows, uri });
      await connection.run(
        `COPY (SELECT ${selectList()} FROM live.trip_stop_events WHERE service_date = ?)
         TO '${uri}' (FORMAT PARQUET, COMPRESSION ZSTD, OVERWRITE_OR_IGNORE)`,
        [serviceDate],
      );
      written.push({ serviceDate, uri, rows });
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  log?.info("export complete", {
    partitions: written.length,
    rows: written.reduce((total, p) => total + p.rows, 0),
  });
  return written;
}

/** Service dates present in the database, oldest first. */
export async function availableServiceDates(dbPath: string): Promise<string[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run("INSTALL sqlite; LOAD sqlite;");
    await connection.run(`ATTACH ${literal(dbPath)} AS live (TYPE sqlite, READ_ONLY)`);
    const result = await connection.runAndReadAll(
      "SELECT DISTINCT service_date AS d FROM live.trip_stop_events ORDER BY d",
    );
    return result.getRowObjects().map((row) => String((row as { d: unknown }).d));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
