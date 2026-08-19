import { gunzipSync } from "node:zlib";
import { DATASETS, type DatasetName } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";

/**
 * The shared half of landing a model-written dataset: list the partitions, decode
 * one, validate every row, replace the day. Predictions and scorecards differ only
 * in their schema and their table, and a second copy of this loop would drift.
 */

export interface ObjectReader {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Uint8Array>;
}

export interface ImportedDay {
  serviceDate: string;
  rows: number;
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
}

export async function importPartitions<Row>(options: PartitionImport<Row>): Promise<ImportedDay[]> {
  const { dataset, reader, parse, replace, log } = options;
  const keys = (await reader.list(`${DATASETS[dataset].prefix}/`)).sort();

  const imported: ImportedDay[] = [];
  for (const key of keys) {
    const serviceDate = serviceDateFromKey(dataset, key);
    if (!serviceDate) {
      log?.warn("skipping object that is not a service-date partition", { key, dataset });
      continue;
    }
    if (options.serviceDates && !options.serviceDates.includes(serviceDate)) continue;

    const rows = parse(serviceDate, await reader.get(key));
    replace(serviceDate, rows);
    log?.info("imported partition", { dataset, serviceDate, rows: rows.length, key });
    imported.push({ serviceDate, rows: rows.length });
  }

  log?.info("import complete", {
    dataset,
    days: imported.length,
    rows: imported.reduce((total, day) => total + day.rows, 0),
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
