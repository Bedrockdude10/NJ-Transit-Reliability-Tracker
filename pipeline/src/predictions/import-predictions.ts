import type { Repositories } from "@njt/db";
import { type DelayPrediction, delayPredictionSchema, intervalProblem } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import type { ObjectStore } from "../archive/object-store";
import {
  contractError,
  type ImportedDay,
  importPartitions,
  type ObjectReader,
  parseJsonlGz,
  serviceDateFromKey as partitionDate,
} from "./import-jsonl";
import { s3Reader } from "./object-reader";

/**
 * Everything read here is untrusted — produced by a repo that shares no code with
 * this one — so every row goes through `delayPredictionSchema` before it is stored.
 */

export type { ImportedDay, ObjectReader };
export { s3Reader };

export interface ImportOptions {
  repos: Repositories;
  store: ObjectStore;
  reader?: ObjectReader;
  /** Only import these service dates. Everything published, by default. */
  serviceDates?: readonly string[];
  log?: Logger;
  /** Passed by a resident loop so unchanged days are not downloaded again. */
  knownEtags?: Map<string, string>;
}

export function serviceDateFromKey(key: string): string | null {
  return partitionDate("predictions", key);
}

export function parsePredictions(serviceDate: string, body: Uint8Array): DelayPrediction[] {
  return parseJsonlGz(serviceDate, body, (record, line) => {
    const parsed = delayPredictionSchema.safeParse(record);
    if (!parsed.success) throw contractError(serviceDate, line, parsed.error.issues);
    // Coherence the generated schema cannot state: the interval fields are optional
    // individually but meaningless individually. An incoherent range is how a unit
    // mixup shows up, and it would render as a confident wrong answer.
    const problem = intervalProblem(parsed.data);
    if (problem !== null) throw new Error(`${serviceDate}: line ${line} ${problem}`);
    return parsed.data;
  });
}

export async function importPredictions(options: ImportOptions): Promise<ImportedDay[]> {
  const { repos, store } = options;
  return importPartitions({
    dataset: "predictions",
    reader: options.reader ?? s3Reader(store),
    parse: parsePredictions,
    replace: (serviceDate, rows) => repos.predictions.replaceServiceDate(serviceDate, rows),
    serviceDates: options.serviceDates,
    log: options.log,
    knownEtags: options.knownEtags,
  });
}
