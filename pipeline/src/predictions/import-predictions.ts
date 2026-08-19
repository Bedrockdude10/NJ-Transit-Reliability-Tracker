import { gunzipSync } from "node:zlib";
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { Repositories } from "@njt/db";
import { DATASETS, type DelayPrediction } from "@njt/shared";
import { delayPredictionSchema, intervalProblem } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import { createClient, type ObjectStore } from "../archive/object-store";

/**
 * Everything read here is untrusted — produced by a repo that shares no code with
 * this one — so every row goes through `delayPredictionSchema` before it is stored.
 */

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
 * All-or-nothing per day: a half-written upload parses cleanly up to the cut, so
 * taking those lines would import a partial day as if it were complete.
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
    // Coherence the generated schema cannot state: the interval fields are optional
    // individually but meaningless individually. An incoherent range is how a unit
    // mixup shows up, and it would render as a confident wrong answer.
    const problem = intervalProblem(parsed.data);
    if (problem !== null) throw new Error(`${serviceDate}: line ${index + 1} ${problem}`);
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
      const body = object.Body;
      if (body === undefined) throw new Error(`object ${key} has no body`);
      return body.transformToByteArray();
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
      log?.warn("skipping object that is not a service-date partition", { key });
      continue;
    }
    if (options.serviceDates && !options.serviceDates.includes(serviceDate)) continue;

    const predictions = parsePredictions(serviceDate, await reader.get(key));
    // Replace, don't merge: a re-run can publish *fewer* legs than the one before
    // (a corrected model drops bad ones), and merging would keep what it replaced.
    repos.predictions.replaceServiceDate(serviceDate, predictions);
    log?.info("imported predictions", { serviceDate, rows: predictions.length, key });
    imported.push({ serviceDate, rows: predictions.length });
  }

  log?.info("prediction import complete", {
    days: imported.length,
    rows: imported.reduce((total, day) => total + day.rows, 0),
  });
  return imported;
}
