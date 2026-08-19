import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Repositories } from "@njt/db";
import { CONTRACT_VERSION, datasetKey, type TripStopEvent } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
// Imported, not read from disk: this is the contract *this build* was made against,
// and a runtime read breaks once bundled (the path is relative to the module).
import manifest from "../../../contract/v1/manifest.json" with { type: "json" };
import { availableMemoryMb, insufficientMemory } from "./machine";
import {
  bodyDigest,
  createClient,
  type ObjectStore,
  type ObjectWriter,
  putVerified,
} from "./object-store";

/**
 * Publish derived events to object storage for the Python modelling repo, as gzipped
 * JSON Lines — one object per service date. See CLAUDE.md and DEPLOY.md.
 */

/** A service date is a few MB serialised, on top of Node's own ~90 MB. */
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
  return field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

/** Which service dates a run should publish. */
export interface ExportWindow {
  /** Publish this date onwards. */
  from?: string | undefined;
  /** Publish only the last N dates, whatever they are. */
  recent?: number | undefined;
}

/**
 * The archive is ~35 partitions and each is gzipped whole in memory so it can be
 * hashed, on a 512 MB machine that must not be disturbed. Re-publishing all of
 * them is right after a repair and wrong every hour, so a frequent run narrows to
 * the newest few and only those are rebuilt.
 */
export function datesToExport(all: readonly string[], window: ExportWindow): string[] {
  const from = window.from;
  const scoped = from ? all.filter((date) => date >= from) : [...all];
  return window.recent === undefined ? scoped : scoped.slice(-window.recent);
}

/** Object key for a service date, from the shared dataset descriptor. */
export function partitionKey(serviceDate: string): string {
  return datasetKey("events", serviceDate);
}

/**
 * One JSON object per line, newline-*terminated* so concatenating two files is still
 * valid JSON Lines and a truncated final line is detectable. Nullable fields must be
 * explicit nulls: `JSON.stringify` drops `undefined`, so an absent one would vanish.
 */
export function serialize(events: readonly TripStopEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

/** Where the contract this producer was built against is published in the bucket. */
export function manifestKey(): string {
  return `contract/${CONTRACT_VERSION}/manifest.json`;
}

/**
 * Publish the contract manifest next to the data it describes. CI in both repos only
 * compares two checkouts; this is what catches a *deployed* producer writing an older
 * contract than the consumer was generated from.
 */
export async function publishManifest(
  store: ObjectStore,
  client: ObjectWriter,
  log?: Logger,
  knownDigests?: Map<string, string>,
): Promise<string> {
  const key = manifestKey();
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const digest = bodyDigest(body);
  if (knownDigests?.get(key) === digest) return manifest.digest;

  await putVerified(client, { bucket: store.bucket, key, body, contentType: "application/json" });
  knownDigests?.set(key, digest);
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
  /**
   * Digest of each key this process last stored, updated in place. A resident loop
   * passes one so an unchanged partition costs a gzip instead of an upload; a
   * one-shot run passes nothing and republishes.
   */
  knownDigests?: Map<string, string>;
}

export interface ExportedPartition {
  serviceDate: string;
  key: string;
  rows: number;
  bytes: number;
  /** Built and hashed, but identical to what this process already stored. */
  skipped: boolean;
}

/**
 * Export the given service dates. Returns one entry per date actually written.
 *
 * A date with no events is skipped rather than written empty: an empty object is
 * indistinguishable from a day the pipeline missed, and a model would read it as
 * "no trains ran".
 */
export async function exportEvents(options: ExportOptions): Promise<ExportedPartition[]> {
  const { repos, store, serviceDates } = options;
  const log = options.log;
  const client = options.client ?? createClient(store);

  const shortfall = insufficientMemory(
    "export events",
    REQUIRED_MEMORY_MB,
    (options.availableMemoryMb ?? availableMemoryMb)(),
  );
  if (shortfall) throw new Error(shortfall);

  const known = options.knownDigests;

  // Before the data, so a consumer never sees rows whose manifest is not there yet.
  await publishManifest(store, client, log, known);

  const written: ExportedPartition[] = [];
  for (const serviceDate of serviceDates) {
    // Built in one piece rather than streamed: the gzipped body has to be held
    // whole in any case, to hash it.
    const events = repos.events.getByServiceDate(serviceDate);
    if (events.length === 0) {
      log?.warn("no events for service date; skipping", { serviceDate });
      continue;
    }

    const key = partitionKey(serviceDate);
    const body = gzipSync(serialize(events));
    const digest = bodyDigest(body);
    const common = { serviceDate, key, rows: events.length, bytes: body.byteLength };

    // gzip is deterministic for identical input, so an unchanged day hashes the
    // same and needs no request. Yesterday's partition stops moving hours before
    // the loop does.
    if (known?.get(key) === digest) {
      written.push({ ...common, skipped: true });
      continue;
    }

    const { bytes } = await putVerified(client, {
      bucket: store.bucket,
      key,
      body,
      contentType: "application/gzip",
    });
    known?.set(key, digest);

    log?.info("exported service date", { serviceDate, rows: events.length, key, bytes });
    written.push({ ...common, bytes, skipped: false });
  }

  const uploaded = written.filter((partition) => !partition.skipped);
  log?.info("export complete", {
    partitions: uploaded.length,
    unchanged: written.length - uploaded.length,
    rows: uploaded.reduce((total, p) => total + p.rows, 0),
  });
  return written;
}
