import type { DelayPrediction } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/database";
import { PredictionRepository } from "../src/repositories/predictions";

/**
 * Predictions are produced by another repo and arrive through object storage, so
 * this store is a landing area: the API reads it, nothing here derives from it.
 *
 * What matters is that re-importing is safe. The modelling repo rewrites a
 * service date whenever it re-runs — a better model, a backfill, actuals filled
 * in after the trips ran — and the same prediction must update rather than
 * accumulate duplicates the API would then double-count.
 */

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

let db: Database;
let repo: PredictionRepository;

beforeEach(() => {
  db = openDatabase();
  repo = new PredictionRepository(db);
});

describe("storing predictions", () => {
  it("round-trips a prediction unchanged", () => {
    repo.upsertMany([PREDICTION]);
    expect(repo.forServiceDate("2026-08-14")).toEqual([PREDICTION]);
  });

  it("keeps null actuals null rather than zero", () => {
    // Null means "the trip has not run yet"; zero means "it was on time". A
    // model scored against zeroes would look wrong in both directions.
    repo.upsertMany([PREDICTION]);
    expect(repo.forServiceDate("2026-08-14")[0]!.actualDelaySeconds).toBeNull();
  });

  it("replaces a prediction rather than duplicating it", () => {
    // The modelling repo rewrites a whole service date on every run.
    repo.upsertMany([PREDICTION]);
    repo.upsertMany([{ ...PREDICTION, predictedDelaySeconds: 300, runId: "run-b" }]);

    const stored = repo.forServiceDate("2026-08-14");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.predictedDelaySeconds).toBe(300);
    expect(stored[0]!.runId).toBe("run-b");
  });

  it("replaces a whole service date, dropping legs the new run no longer predicts", () => {
    // The modelling repo rewrites a service date on every run, and a re-run can
    // emit *fewer* legs than before — because the model changed, or because the
    // old ones were wrong. Upserting alone leaves those behind forever: a bad
    // prediction was still being served after the run that produced it had been
    // corrected and republished.
    repo.replaceServiceDate("2026-08-14", [PREDICTION, { ...PREDICTION, toStopId: "109" }]);
    expect(repo.forServiceDate("2026-08-14")).toHaveLength(2);

    repo.replaceServiceDate("2026-08-14", [PREDICTION]);
    expect(repo.forServiceDate("2026-08-14").map((p) => p.toStopId)).toEqual(["107"]);
  });

  it("replaces only the date it was given", () => {
    repo.replaceServiceDate("2026-08-14", [PREDICTION]);
    repo.replaceServiceDate("2026-08-15", [{ ...PREDICTION, serviceDate: "2026-08-15" }]);
    expect(repo.serviceDates()).toEqual(["2026-08-14", "2026-08-15"]);
  });

  it("treats a different leg of the same trip as a different prediction", () => {
    // One trip is predicted from many stops to many stops; collapsing them would
    // silently discard all but one.
    repo.upsertMany([PREDICTION, { ...PREDICTION, toStopId: "109" }]);
    expect(repo.forServiceDate("2026-08-14")).toHaveLength(2);
  });

  it("returns predictions for one service date only", () => {
    repo.upsertMany([PREDICTION, { ...PREDICTION, serviceDate: "2026-08-15" }]);
    expect(repo.forServiceDate("2026-08-14")).toHaveLength(1);
  });

  it("orders by the stop the prediction is about, so a trip reads in order", () => {
    repo.upsertMany([
      { ...PREDICTION, toStopId: "109", horizonSeconds: 3600 },
      { ...PREDICTION, toStopId: "107", horizonSeconds: 1800 },
    ]);
    expect(repo.forServiceDate("2026-08-14").map((p) => p.horizonSeconds)).toEqual([1800, 3600]);
  });
});

describe("reporting what is held", () => {
  it("says which service dates have predictions", () => {
    // The API needs this to answer "is there anything to show?" without reading
    // a day's rows, and the importer uses it to report what it landed.
    repo.upsertMany([PREDICTION, { ...PREDICTION, serviceDate: "2026-08-15" }]);
    expect(repo.serviceDates()).toEqual(["2026-08-14", "2026-08-15"]);
  });

  it("has nothing to say before the modelling repo has run", () => {
    // The honest empty state: no predictions is the normal condition until a
    // model is trained, and it must not look like an error.
    expect(repo.serviceDates()).toEqual([]);
    expect(repo.forServiceDate("2026-08-14")).toEqual([]);
    expect(repo.latestRun()).toBeNull();
  });

  it("reports the most recent run, for showing what produced the numbers", () => {
    repo.upsertMany([PREDICTION]);
    repo.upsertMany([
      {
        ...PREDICTION,
        tripId: "T2",
        predictedAtEpochSeconds: PREDICTION.predictedAtEpochSeconds + 60,
        modelVersion: "lgbm-0.2.0",
        runId: "run-b",
      },
    ]);
    expect(repo.latestRun()).toEqual({
      modelVersion: "lgbm-0.2.0",
      runId: "run-b",
      predictedAtEpochSeconds: PREDICTION.predictedAtEpochSeconds + 60,
    });
  });
});
