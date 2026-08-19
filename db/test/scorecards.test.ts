import type { ModelScorecard } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src";

/**
 * Per-model accuracy, landed from object storage. This is the record of how well
 * each model version did, so a later version can be compared against it.
 */

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

describe("ScorecardRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("keeps one row per model, run, date and horizon", () => {
    repos.scorecards.upsertMany([
      CARD,
      { ...CARD, horizonSeconds: 2700, maeSeconds: 140.0 },
      { ...CARD, runId: "run-b", maeSeconds: 55.0 },
    ]);
    expect(repos.scorecards.forServiceDate("2026-08-14")).toHaveLength(3);
  });

  it("treats a re-run of the same horizon as authoritative", () => {
    repos.scorecards.upsertMany([CARD]);
    repos.scorecards.upsertMany([{ ...CARD, maeSeconds: 61.9 }]);

    const rows = repos.scorecards.forServiceDate("2026-08-14");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.maeSeconds).toBe(61.9);
  });

  it("drops legs a re-run no longer scores, rather than serving orphans", () => {
    repos.scorecards.upsertMany([CARD, { ...CARD, horizonSeconds: 2700 }]);
    repos.scorecards.replaceServiceDate("2026-08-14", [CARD]);

    expect(repos.scorecards.forServiceDate("2026-08-14")).toHaveLength(1);
  });

  it("lists the model versions it holds, newest run first", () => {
    repos.scorecards.upsertMany([
      CARD,
      { ...CARD, modelVersion: "cascade-0.2.0", runId: "run-c", serviceDate: "2026-08-15" },
    ]);
    expect(repos.scorecards.modelVersions()).toEqual(["cascade-0.1.0", "cascade-0.2.0"]);
  });

  it("returns every row across dates, for comparing versions over time", () => {
    repos.scorecards.upsertMany([CARD, { ...CARD, serviceDate: "2026-08-15" }]);
    expect(repos.scorecards.all()).toHaveLength(2);
  });

  it("round-trips every contract field", () => {
    repos.scorecards.upsertMany([CARD]);
    expect(repos.scorecards.forServiceDate("2026-08-14")[0]).toEqual(CARD);
  });

  it("has no rows before a model has run", () => {
    expect(repos.scorecards.serviceDates()).toEqual([]);
    expect(repos.scorecards.all()).toEqual([]);
  });
});
