import { gunzipSync } from "node:zlib";
import { DATASETS, type DatasetName } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";

/**
 * The shared half of landing a model-written dataset: list the partitions, decode
 * one, validate every row, replace the day. Predictions and scorecards differ only
 * in their schema and their table, and a second copy of this loop would drift.
 */

/** What a listing says about one object, without downloading it. */
export interface ListedObject {
  key: string;
  /**
   * The store's digest, or null where it does not give one. Uploads here are
   * single-part with a `Content-MD5`, so this is the MD5 of the body — the same
   * digest the producing side computed.
   */
  etag: string | null;
}

export interface ObjectReader {
  list: (prefix: string) => Promise<ListedObject[]>;
  get: (key: string) => Promise<Uint8Array>;
}

export interface ImportedDay {
  serviceDate: string;
  /** Rows stored by *this* pass, so zero when the day was skipped. */
  rows: number;
  /** Listed, and identical to what this process already imported. */
  skipped: boolean;
}

/** `predictions/service_date=2026-08-14/predictions.jsonl.gz` → `2026-08-14`. */
export function serviceDateFromKey(dataset: DatasetName, key: string): string | null {
  const match = new RegExp(`${DATASETS[dataset].partitionBy}=(\\d{4}-\\d{2}-\\d{2})`, "u").exec(key);
  return match?.[1] ?? null;
}

/**
 * All-or-nothing per day: a half-written upload parses cleanly up to the cut, so
 * taking those lines would import a partial day as if it were complete.
 */
export function parseJsonlGz<Row>(
  serviceDate: string,
  body: Uint8Array,
  validate: (record: unknown, line: number) => Row,
): Row[] {
  const text = gunzipSync(body).toString("utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);

  return lines.map((line, index) => {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (cause) {
      throw new Error(`${serviceDate}: line ${index + 1} is not valid JSON`, { cause });
    }
    return validate(record, index + 1);
  });
}

export interface PartitionImport<Row> {
  dataset: DatasetName;
  reader: ObjectReader;
  parse: (serviceDate: string, body: Uint8Array) => Row[];
  /**
   * Replace, don't merge: a re-run can publish *fewer* rows than the one before,
   * and merging would keep serving what it replaced.
   */
  replace: (serviceDate: string, rows: readonly Row[]) => void;
  serviceDates?: readonly string[] | undefined;
  log?: Logger | undefined;
  /**
   * ETag of each key this process last imported, updated in place. A resident loop
   * passes one so an unchanged day costs nothing beyond the listing; a one-shot run
   * passes nothing and re-reads everything.
   */
  knownEtags?: Map<string, string> | undefined;
}

export async function importPartitions<Row>(options: PartitionImport<Row>): Promise<ImportedDay[]> {
  const { dataset, reader, parse, replace, log } = options;
  const known = options.knownEtags;
  const listed = (await reader.list(`${DATASETS[dataset].prefix}/`)).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const imported: ImportedDay[] = [];
  for (const { key, etag } of listed) {
    const serviceDate = serviceDateFromKey(dataset, key);
    if (!serviceDate) {
      log?.warn("skipping object that is not a service-date partition", { key, dataset });
      continue;
    }
    if (options.serviceDates && !options.serviceDates.includes(serviceDate)) continue;

    // A listing is one request whatever it returns, so comparing digests here is
    // what makes a frequent pass cost nothing for days that have stopped moving.
    if (etag !== null && known?.get(key) === etag) {
      imported.push({ serviceDate, rows: 0, skipped: true });
      continue;
    }

    const rows = parse(serviceDate, await reader.get(key));
    replace(serviceDate, rows);
    // Only once the day is stored: a pass that threw must read it again.
    if (etag !== null) known?.set(key, etag);
    log?.info("imported partition", { dataset, serviceDate, rows: rows.length, key });
    imported.push({ serviceDate, rows: rows.length, skipped: false });
  }

  const read = imported.filter((day) => !day.skipped);
  log?.info("import complete", {
    dataset,
    days: read.length,
    unchanged: imported.length - read.length,
    rows: read.reduce((total, day) => total + day.rows, 0),
  });
  return imported;
}

/** A schema failure, phrased so the offending field is in the message. */
export function contractError(
  serviceDate: string,
  line: number,
  issues: readonly { path: PropertyKey[]; message: string }[],
): Error {
  return new Error(
    `${serviceDate}: line ${line} does not match the contract — ${issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}
