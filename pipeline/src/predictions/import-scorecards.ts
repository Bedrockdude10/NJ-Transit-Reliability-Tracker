import type { Repositories } from "@njt/db";
import { type ModelScorecard, modelScorecardSchema } from "@njt/shared";
import type { Logger } from "@njt/shared/logger";
import type { ObjectStore } from "../archive/object-store";
import {
  contractError,
  type ImportedDay,
  importPartitions,
  type ObjectReader,
  parseJsonlGz,
} from "./import-jsonl";
import { s3Reader } from "./object-reader";

/**
 * Everything read here is untrusted — produced by a repo that shares no code with
 * this one — so every row goes through `modelScorecardSchema` before it is stored.
 */

export interface ScorecardImportOptions {
  repos: Repositories;
  store: ObjectStore;
  reader?: ObjectReader;
  /** Only import these service dates. Everything published, by default. */
  serviceDates?: readonly string[];
  log?: Logger;
}

export function parseScorecards(serviceDate: string, body: Uint8Array): ModelScorecard[] {
  return parseJsonlGz(serviceDate, body, (record, line) => {
    const parsed = modelScorecardSchema.safeParse(record);
    if (!parsed.success) throw contractError(serviceDate, line, parsed.error.issues);
    return parsed.data;
  });
}

export async function importScorecards(
  options: ScorecardImportOptions,
): Promise<ImportedDay[]> {
  const { repos, store } = options;
  return importPartitions({
    dataset: "scorecards",
    reader: options.reader ?? s3Reader(store),
    parse: parseScorecards,
    replace: (serviceDate, rows) => repos.scorecards.replaceServiceDate(serviceDate, rows),
    serviceDates: options.serviceDates,
    log: options.log,
  });
}
