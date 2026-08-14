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
 * The contract projection: SQLite columns aliased to the field names in
 * `trip-stop-event.schema.json`.
 *
 * Booleans are the one real conversion — SQLite stores 0/1 and the contract says
 * boolean, so an unconverted export would produce integer columns that fail
 * validation on the Python side.
 */
export const EVENT_COLUMNS = [
  ["trip_id", "tripId"],
  ["route_id", "routeId"],
  ["line_name", "lineName"],
  ["stop_id", "stopId"],
  ["stop_name", "stopName"],
  ["stop_sequence", "stopSequence"],
  ["direction", "direction"],
  ["service_date", "serviceDate"],
  ["scheduled_arrival", "scheduledArrival"],
  ["scheduled_departure", "scheduledDeparture"],
  ["observed_arrival", "observedArrival"],
  ["delay_seconds", "delaySeconds"],
  ["stop_skipped", "stopSkipped", "boolean"],
  ["trip_cancelled", "tripCancelled", "boolean"],
  ["gtfs_static_version", "gtfsStaticVersion"],
  ["ingested_at_ms", "ingestedAtMs"],
] as const satisfies readonly (readonly [string, string] | readonly [string, string, "boolean"])[];

/** The SELECT list, with 0/1 columns cast to real booleans. */
export function selectList(): string {
  return EVENT_COLUMNS.map((column) => {
    const [source, alias] = column;
    const expression = column.length === 3 ? `CAST(${source} AS BOOLEAN)` : source;
    return `${expression} AS "${alias}"`;
  }).join(", ");
}

/** Field names the export produces, for checking against the JSON Schema. */
export function exportedFields(): string[] {
  return EVENT_COLUMNS.map(([, alias]) => alias);
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
 * A SQL string literal.
 *
 * DuckDB's DDL — `ATTACH`, `CREATE SECRET` — does not accept bind parameters, so
 * these values have to be interpolated. Queries below still bind their
 * parameters; this is only for the statements that cannot.
 */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Configure DuckDB's S3 client. */
async function configureStore(
  connection: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  store: ObjectStore,
): Promise<void> {
  await connection.run("INSTALL sqlite; LOAD sqlite; INSTALL httpfs; LOAD httpfs;");
  await connection.run(
    `CREATE OR REPLACE SECRET njt_store (
       TYPE s3,
       KEY_ID ${literal(store.accessKeyId)},
       SECRET ${literal(store.secretAccessKey)},
       REGION ${literal(store.region)},
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
