import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Repositories } from "@njt/db";
import { CONTRACT_VERSION, datasetKey, type TripStopEvent } from "@njt/shared";
// Imported rather than read from disk: this is *the contract this build was made
// against*, which is precisely what the consumer needs to compare itself with.
// Reading it at runtime also broke once bundled — the path is relative to the
// module, and the bundle does not live where the source did.
import manifest from "../../../contract/v1/manifest.json" with { type: "json" };
import type { Logger } from "@njt/shared/logger";
import { availableMemoryMb, insufficientMemory } from "./machine";
import { createClient, type ObjectStore, type ObjectWriter, putVerified } from "./object-store";

/**
 * Publish derived events to object storage for the Python modelling repo, as
 * gzipped JSON Lines — one object per service date.
 *
 * This is the offline half of the seam with `njt-delay-modeling`: training reads
 * bulk history, so it reads immutable files partitioned by service date rather
 * than calling an API. A partition re-read next year yields the same bytes, which
 * is what makes a training run reproducible; an endpoint would return whatever
 * the database says today.
 *
 * **Why JSON Lines and not Parquet.** Parquet was the first design, written
 * through DuckDB, and it could not run where it had to: DuckDB with its
 * extensions costs ~211 MB of resident memory before reading a row, on a machine
 * with ~170 MB to spare. JSON Lines needs no query engine — a day serialises in a
 * few MB — and the consumer converts to Parquet on its own hardware, where memory
 * is not the constraint. The contract is unaffected: `contract/v1` describes
 * *records*, not an encoding.
 *
 * One line per event, in the contract's own field names, because the domain type
 * these come from is what the contract is generated from. There is no projection
 * to keep in step — the assertion that this matches `trip-stop-event.schema.json`
 * is made against real rows in `archive-export.test.ts`.
 */

/**
 * What one run needs. A service date is tens of thousands of events — a few MB
 * serialised, held alongside the rows themselves — on top of Node's own ~90 MB.
 */
const REQUIRED_MEMORY_MB = 145;

/** Fields the contract declares, read from the schema the Python repo generates from. */
interface ContractSchema {
  properties: Record<string, { type?: string; anyOf?: { type?: string }[] }>;
}

const SCHEMA_PATH = new URL(
  `../../../contract/${CONTRACT_VERSION}/trip-stop-event.schema.json`,
  import.meta.url,
);

export function exportedFields(): string[] {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as ContractSchema;
  return Object.keys(schema.properties);
}

/** `ingestedAtMs` → `ingested_at_ms`. The repo's own naming convention. */
export function sqliteColumn(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Object key for a service date, from the shared dataset descriptor.
 *
 * Not spelled out here: the modelling repo builds the same key from the same
 * `contract/v1/datasets.json`, and a layout written out twice is drift that fails
 * silently — the reader finds no objects and reports success.
 */
export function partitionKey(serviceDate: string): string {
  return datasetKey("events", serviceDate);
}

/**
 * One JSON object per line, newline-terminated.
 *
 * Newline-terminated rather than newline-separated so that concatenating two
 * files is still valid JSON Lines, and so a truncated final line is detectable.
 * `undefined` is dropped by `JSON.stringify`, so a nullable field that is absent
 * rather than null would silently vanish — the repository returns explicit nulls,
 * and the round-trip test holds that.
 */
export function serialize(events: readonly TripStopEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

/** Where the contract this producer was built against is published in the bucket. */
export function manifestKey(): string {
  return `contract/${CONTRACT_VERSION}/manifest.json`;
}

/**
 * Publish the contract manifest next to the data it describes.
 *
 * Both repos already fail CI when their generated models are stale, but that
 * compares two checkouts. It cannot see the case that actually bites: a producer
 * deployed weeks ago writing an older contract than the consumer was generated
 * from. Writing the manifest the producer was *built* with, on every run, lets
 * the consumer check the deployment it is actually reading from — and turns that
 * disagreement into a sentence naming both digests instead of rows quietly
 * failing validation.
 */
export async function publishManifest(
  store: ObjectStore,
  client: ObjectWriter,
  log?: Logger,
): Promise<string> {
  const key = manifestKey();
  await putVerified(client, {
    bucket: store.bucket,
    key,
    body: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    contentType: "application/json",
  });
  log?.info("published contract manifest", { key, digest: manifest.digest });
  return manifest.digest;
}

export interface ExportOptions {
  repos: Repositories;
  store: ObjectStore;
  /** Service dates to publish. Each becomes exactly one object. */
  serviceDates: readonly string[];
  client?: ObjectWriter;
  /** Injected for tests. Allocatable memory in MB, or null if unknown. */
  availableMemoryMb?: () => number | null;
  log?: Logger;
}

export interface ExportedPartition {
  serviceDate: string;
  key: string;
  rows: number;
  bytes: number;
}

/**
 * Export the given service dates. Returns one entry per date actually written.
 *
 * A date with no events is skipped rather than written empty: an empty object is
 * indistinguishable from a day the pipeline missed, and a model reading it would
 * treat "no trains ran" as fact.
 */
export async function exportEvents(options: ExportOptions): Promise<ExportedPartition[]> {
  const { repos, store, serviceDates } = options;
  const log = options.log;
  const client = options.client ?? createClient(store);

  // Shares the machine with the API and the pipeline; see ./machine.
  const shortfall = insufficientMemory(
    "export events",
    REQUIRED_MEMORY_MB,
    (options.availableMemoryMb ?? availableMemoryMb)(),
  );
  if (shortfall) throw new Error(shortfall);

  // Before the data, so a consumer never sees rows described by a manifest that
  // is not there yet.
  await publishManifest(store, client, log);

  const written: ExportedPartition[] = [];
  for (const serviceDate of serviceDates) {
    // A service date is bounded — a day of NJT rail is tens of thousands of
    // events, a few MB serialised — so it is built in one piece rather than
    // streamed. The gzipped body has to be held whole in any case, to hash it.
    const events = repos.events.getByServiceDate(serviceDate);
    if (events.length === 0) {
      log?.warn("no events for service date; skipping", { serviceDate });
      continue;
    }

    const key = partitionKey(serviceDate);
    const body = gzipSync(serialize(events));
    const { bytes } = await putVerified(client, {
      bucket: store.bucket,
      key,
      body,
      contentType: "application/gzip",
    });

    log?.info("exported service date", { serviceDate, rows: events.length, key, bytes });
    written.push({ serviceDate, key, rows: events.length, bytes });
  }

  log?.info("export complete", {
    partitions: written.length,
    rows: written.reduce((total, p) => total + p.rows, 0),
  });
  return written;
}
