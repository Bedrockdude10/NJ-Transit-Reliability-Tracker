import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { datasetKey, type ModelScorecard } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectStore } from "../src/archive/object-store";
import { importScorecards } from "../src/predictions/import-scorecards";

/**
 * Scorecards are how each model version's accuracy is kept, so a later version can
 * be compared against an earlier one. Same trust boundary as predictions: they come
 * from a repo sharing no code with this one, so every row goes through the schema.
 */

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "example.invalid",
  accessKeyId: "k",
  secretAccessKey: "s",
  region: "auto",
};

const CARD: ModelScorecard = {
  modelVersion: "cascade-0.1.0",
  runId: "run-a",
  serviceDate: "2026-08-14",
  horizonSeconds: 270,
  predictions: 7173,
  maeSeconds: 58.4,
  biasSeconds: 8.2,
  falselyReassuringPercent: 43.3,
};

function bucket(objects: Record<string, unknown[] | string>) {
  const bodies = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(objects)) {
    const text =
      typeof value === "string" ? value : `${value.map((row) => JSON.stringify(row)).join("\n")}\n`;
    bodies.set(key, gzipSync(text));
  }
  return {
    list: async (prefix: string) =>
      [...bodies.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({ key, etag: createHash("md5").update(body).digest("hex") })),
    get: async (key: string) => {
      const body = bodies.get(key);
      if (!body) throw new Error(`no such object: ${key}`);
      return body;
    },
  };
}

let db: Database;
let repos: Repositories;

beforeEach(() => {
  db = openDatabase();
  repos = createRepositories(db);
});

const KEY = datasetKey("scorecards", "2026-08-14");

describe("importing scorecards", () => {
  it("lands every horizon it is given", async () => {
    const reader = bucket({ [KEY]: [CARD, { ...CARD, horizonSeconds: 2700, maeSeconds: 140 }] });

    const imported = await importScorecards({ repos, store: STORE, reader, log: silentLogger });

    expect(imported).toEqual([{ serviceDate: "2026-08-14", rows: 2, skipped: false }]);
    expect(repos.scorecards.forServiceDate("2026-08-14")).toHaveLength(2);
  });

  it("rejects the whole day rather than importing a half-written upload", async () => {
    // A truncated final line parses cleanly up to the cut, so taking the lines
    // that did parse would land a partial day as though it were complete.
    const reader = bucket({ [KEY]: `${JSON.stringify(CARD)}\n{"modelVersion":"cascad` });

    await expect(
      importScorecards({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow(/not valid JSON/u);
    expect(repos.scorecards.forServiceDate("2026-08-14")).toEqual([]);
  });

  it("rejects a row that does not match the contract, naming the field", async () => {
    const reader = bucket({ [KEY]: [{ ...CARD, maeSeconds: "fast" }] });

    await expect(
      importScorecards({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow(/maeSeconds/u);
    expect(repos.scorecards.forServiceDate("2026-08-14")).toEqual([])
  });

  it("replaces a day rather than merging, so a re-scored day loses its orphans", async () => {
    repos.scorecards.upsertMany([CARD, { ...CARD, horizonSeconds: 9999 }]);
    const reader = bucket({ [KEY]: [CARD] });

    await importScorecards({ repos, store: STORE, reader, log: silentLogger });

    expect(repos.scorecards.forServiceDate("2026-08-14")).toHaveLength(1);
  });

  it("imports only the dates asked for", async () => {
    const other = datasetKey("scorecards", "2026-08-15");
    const reader = bucket({ [KEY]: [CARD], [other]: [{ ...CARD, serviceDate: "2026-08-15" }] });

    const imported = await importScorecards({
      repos,
      store: STORE,
      reader,
      serviceDates: ["2026-08-15"],
      log: silentLogger,
    });

    expect(imported).toEqual([{ serviceDate: "2026-08-15", rows: 1, skipped: false }]);
  });

  it("does nothing, quietly, when no model has published yet", async () => {
    const imported = await importScorecards({
      repos,
      store: STORE,
      reader: bucket({}),
      log: silentLogger,
    });
    expect(imported).toEqual([]);
  });
});
