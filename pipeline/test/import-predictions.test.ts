import { gzipSync } from "node:zlib";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { datasetKey, type DelayPrediction } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { importPredictions } from "../src/predictions/import-predictions";
import type { ObjectStore } from "../src/archive/object-store";

/**
 * Predictions come from a repo that shares no code with this one, so everything
 * arriving is treated as untrusted until it has been through the generated
 * contract schema.
 *
 * The failure worth preventing is not a crash: it is a malformed or half-written
 * object being imported anyway, and the app then showing numbers nobody can
 * account for. A day that fails validation is left alone, loudly.
 */

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "example.invalid",
  accessKeyId: "k",
  secretAccessKey: "s",
  region: "auto",
};

const PREDICTION: DelayPrediction = {
  tripId: "T1",
  lineName: "Northeast Corridor",
  serviceDate: "2026-08-14",
  fromStopId: "105",
  toStopId: "107",
  predictedAtEpochSeconds: 1_786_500_000,
  horizonSeconds: 1800,
  predictedDelaySeconds: 240,
  actualDelaySeconds: null,
  modelVersion: "lgbm-0.1.0",
  runId: "run-a",
};

/** Serves objects the way the modelling repo writes them: gzipped JSON Lines. */
function bucket(objects: Record<string, unknown[] | string>) {
  const bodies = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(objects)) {
    const text =
      typeof value === "string" ? value : `${value.map((row) => JSON.stringify(row)).join("\n")}\n`;
    bodies.set(key, gzipSync(text));
  }
  return {
    bodies,
    list: async (prefix: string) => [...bodies.keys()].filter((key) => key.startsWith(prefix)),
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

const KEY = datasetKey("predictions", "2026-08-14");

describe("importing predictions", () => {
  it("lands a published day into the database", async () => {
    const reader = bucket({ [KEY]: [PREDICTION] });

    const imported = await importPredictions({ repos, store: STORE, reader, log: silentLogger });

    expect(imported).toEqual([{ serviceDate: "2026-08-14", rows: 1 }]);
    expect(repos.predictions.forServiceDate("2026-08-14")).toEqual([PREDICTION]);
  });

  it("reads the key the modelling repo actually writes", async () => {
    // Built from the shared descriptor on both sides. A reader looking anywhere
    // else finds nothing and reports success, which is the silent failure this
    // whole seam is arranged to prevent.
    expect(KEY).toBe("predictions/service_date=2026-08-14/predictions.jsonl.gz");
  });

  it("is idempotent — importing twice leaves one row", async () => {
    // It runs on a timer against a bucket that mostly has not changed.
    const reader = bucket({ [KEY]: [PREDICTION] });
    await importPredictions({ repos, store: STORE, reader, log: silentLogger });
    await importPredictions({ repos, store: STORE, reader, log: silentLogger });
    expect(repos.predictions.forServiceDate("2026-08-14")).toHaveLength(1);
  });

  it("picks up a re-published day, since the model may have improved", async () => {
    await importPredictions({
      repos,
      store: STORE,
      reader: bucket({ [KEY]: [PREDICTION] }),
      log: silentLogger,
    });
    await importPredictions({
      repos,
      store: STORE,
      reader: bucket({ [KEY]: [{ ...PREDICTION, predictedDelaySeconds: 90, runId: "run-b" }] }),
      log: silentLogger,
    });

    const stored = repos.predictions.forServiceDate("2026-08-14");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.predictedDelaySeconds).toBe(90);
  });

  it("imports nothing, without complaint, before any model has run", async () => {
    // The normal condition until the modelling repo produces its first run. An
    // empty bucket is not an error and must not be logged as one.
    const imported = await importPredictions({
      repos,
      store: STORE,
      reader: bucket({}),
      log: silentLogger,
    });
    expect(imported).toEqual([]);
    expect(repos.predictions.serviceDates()).toEqual([]);
  });
});

describe("refusing what does not match the contract", () => {
  it("rejects a day whose rows are missing a contract field", async () => {
    const { tripId: _dropped, ...incomplete } = PREDICTION;
    const reader = bucket({ [KEY]: [incomplete] });

    await expect(
      importPredictions({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow(/2026-08-14/);
    expect(repos.predictions.serviceDates()).toEqual([]);
  });

  it("rejects a day whose types are wrong, rather than coercing them", async () => {
    // A string where a number belongs is how a producer change arrives. Coerced,
    // it would land silently and the app would show a plausible wrong number.
    const reader = bucket({ [KEY]: [{ ...PREDICTION, predictedDelaySeconds: "240" }] });
    await expect(
      importPredictions({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow();
    expect(repos.predictions.serviceDates()).toEqual([]);
  });

  it("rejects a truncated object rather than importing the readable part", async () => {
    // A half-written upload is the shape of an interrupted producer. Taking the
    // lines that happen to parse would import a partial day as if complete.
    const reader = bucket({ [KEY]: `${JSON.stringify(PREDICTION)}\n{"tripId":"T2","lineNa` });
    await expect(
      importPredictions({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow();
    expect(repos.predictions.serviceDates()).toEqual([]);
  });

  it("leaves already-imported days intact when a later day is bad", async () => {
    // Partial progress is better than none, as long as what landed is whole.
    const good = datasetKey("predictions", "2026-08-13");
    const reader = bucket({
      [good]: [{ ...PREDICTION, serviceDate: "2026-08-13" }],
      [KEY]: [{ ...PREDICTION, horizonSeconds: "soon" }],
    });

    await expect(
      importPredictions({ repos, store: STORE, reader, log: silentLogger }),
    ).rejects.toThrow();
    expect(repos.predictions.serviceDates()).toEqual(["2026-08-13"]);
  });
});

/**
 * Interval fields are optional individually and meaningless individually, and
 * the generated schema can only say the first half. The importer is where the
 * second half is enforced — before a range that contradicts itself is stored and
 * shown to a rider as though the model had said it.
 */
describe("importing prediction intervals", () => {
  const WITH_INTERVAL = {
    ...PREDICTION,
    predictedDelayLowerSeconds: 120,
    predictedDelayUpperSeconds: 400,
    predictionIntervalPercent: 80,
  };

  const importing = (rows: unknown[]) =>
    importPredictions({
      repos,
      store: STORE,
      reader: bucket({ [KEY]: rows }),
      log: silentLogger,
    });

  it("lands a day published with intervals", async () => {
    await importing([WITH_INTERVAL]);
    expect(repos.predictions.forServiceDate("2026-08-14")).toEqual([WITH_INTERVAL]);
  });

  it("still lands a day published without them", async () => {
    // The modelling repo is expected to keep publishing point-only days.
    await importing([PREDICTION]);
    expect(repos.predictions.forServiceDate("2026-08-14")).toEqual([PREDICTION]);
  });

  it("refuses a day carrying bounds with no stated confidence", async () => {
    const partial = { ...PREDICTION, predictedDelayLowerSeconds: 120, predictedDelayUpperSeconds: 400 };
    await expect(importing([partial])).rejects.toThrow(/partial prediction interval/);
  });

  it("refuses an inverted interval", async () => {
    await expect(
      importing([{ ...WITH_INTERVAL, predictedDelayLowerSeconds: 900 }]),
    ).rejects.toThrow(/inverted/);
  });

  it("refuses bounds that do not contain their own point estimate", async () => {
    // What a minutes-vs-seconds mixup looks like: 240s predicted, bounds of 2-7.
    await expect(
      importing([
        {
          ...PREDICTION,
          predictedDelayLowerSeconds: 2,
          predictedDelayUpperSeconds: 7,
          predictionIntervalPercent: 80,
        },
      ]),
    ).rejects.toThrow(/outside its own 80% interval/);
  });

  it("leaves the whole day unimported when one row's interval is bad", async () => {
    // All-or-nothing, like every other validation failure here: a partially
    // imported day is indistinguishable from a complete one once it is stored.
    await expect(importing([WITH_INTERVAL, { ...WITH_INTERVAL, tripId: "T2", predictionIntervalPercent: 0 }]))
      .rejects.toThrow(/between 0 and 100/);
    expect(repos.predictions.forServiceDate("2026-08-14")).toEqual([]);
  });
});
