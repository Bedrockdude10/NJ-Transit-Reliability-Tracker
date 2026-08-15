import { gunzipSync } from "node:zlib";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Repositories } from "@njt/db";
import { DATASETS, type DelayPrediction } from "@njt/shared";
import { delayPredictionSchema } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import { createClient, type ObjectStore } from "../archive/object-store";

/**
 * Import model predictions from object storage into SQLite.
 *
 * The return half of the seam with `njt-delay-modeling`. That repo writes
 * `predictions/service_date=…/predictions.jsonl.gz`; this lands them locally so
 * the API can serve them from a local read, for the same reason every other read
 * is local — the request path should not depend on a bucket being up, and a third
 * party's outage should not be able to take the site down.
 *
 * **Everything here is untrusted.** It was produced by a repo that shares no code
 * with this one, by a model that is expected to change. Every row goes through
 * `delayPredictionSchema` — the runtime shadow of the same TypeScript interface
 * the modelling repo generated its pydantic models from — before it reaches the
 * database. A day that fails is left alone and the run fails loudly, because the
 * alternative is a half-imported day shown as though it were complete.
 */

/** Just enough of object storage to read a prefix. Injected in tests. */
export interface ObjectReader {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Uint8Array>;
}

export interface ImportOptions {
  repos: Repositories;
  store: ObjectStore;
  reader?: ObjectReader;
  /** Only import these service dates. Everything published, by default. */
  serviceDates?: readonly string[];
  log?: Logger;
}

export interface ImportedDay {
  serviceDate: string;
  rows: number;
}

/** `predictions/service_date=2026-08-14/predictions.jsonl.gz` → `2026-08-14`. */
export function serviceDateFromKey(key: string): string | null {
  const match = new RegExp(`${DATASETS.predictions.partitionBy}=(\\d{4}-\\d{2}-\\d{2})`).exec(key);
  return match?.[1] ?? null;
}

/**
 * Parse a whole object into predictions, or throw.
 *
 * All-or-nothing per day. A half-written upload — an interrupted producer — has
 * lines that parse perfectly well up to the cut, and taking those would import a
 * partial day as if it were complete. Nothing is stored unless every line is
 * valid, and validity is decided by the generated contract schema rather than by
 * anything hand-written here.
 */
export function parsePredictions(serviceDate: string, body: Uint8Array): DelayPrediction[] {
  const text = gunzipSync(body).toString("utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);

  return lines.map((line, index) => {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (cause) {
      throw new Error(`${serviceDate}: line ${index + 1} is not valid JSON`, { cause });
    }
    const parsed = delayPredictionSchema.safeParse(record);
    if (!parsed.success) {
      throw new Error(
        `${serviceDate}: line ${index + 1} does not match the contract — ${parsed.error.issues
          .map((issue: { path: PropertyKey[]; message: string }) =>
            `${issue.path.join(".")}: ${issue.message}`,
          )
          .join("; ")}`,
      );
    }
    return parsed.data;
  });
}

/** Reads object storage through the S3 client, for the CLI. */
export function s3Reader(store: ObjectStore, client: S3Client = createClient(store)): ObjectReader {
  return {
    list: async (prefix) => {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: store.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = page.NextContinuationToken;
      } while (token);
      return keys;
    },
    get: async (key) => {
      const object = await client.send(
        new GetObjectCommand({ Bucket: store.bucket, Key: key }),
      );
      return object.Body!.transformToByteArray();
    },
  };
}

export async function importPredictions(options: ImportOptions): Promise<ImportedDay[]> {
  const { repos, store } = options;
  const log = options.log;
  const reader = options.reader ?? s3Reader(store);

  const prefix = `${DATASETS.predictions.prefix}/`;
  const keys = (await reader.list(prefix)).sort();

  const imported: ImportedDay[] = [];
  for (const key of keys) {
    const serviceDate = serviceDateFromKey(key);
    if (!serviceDate) {
      // Something under the prefix that is not a partition. Not this importer's
      // business, and not a reason to fail the run.
      log?.warn("skipping object that is not a service-date partition", { key });
      continue;
    }
    if (options.serviceDates && !options.serviceDates.includes(serviceDate)) continue;

    const predictions = parsePredictions(serviceDate, await reader.get(key));
    // One transaction per day, after the whole day has validated: a day is
    // either fully present or absent, never partly applied.
    repos.predictions.upsertMany(predictions);
    log?.info("imported predictions", { serviceDate, rows: predictions.length, key });
    imported.push({ serviceDate, rows: predictions.length });
  }

  log?.info("prediction import complete", {
    days: imported.length,
    rows: imported.reduce((total, day) => total + day.rows, 0),
  });
  return imported;
}
