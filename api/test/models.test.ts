import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { type ModelScorecard, modelAccuracyResponseSchema } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * `GET /models` — how each model version has scored. Separate from `/predictions`,
 * which is what a rider is shown: one is a forecast, the other is a track record.
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

let db: Database;
let repos: Repositories;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDatabase();
  repos = createRepositories(db);
  app = createApp(repos, silentLogger);
});

const get = async (path: string) => {
  const response = await app.request(path);
  return { status: response.status, body: await response.json() };
};

describe("with no model scored yet", () => {
  it("says so rather than failing or inventing a number", async () => {
    const { status, body } = await get("/models");

    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, models: [] });
  });

  it("still satisfies the response contract the app validates against", async () => {
    const { body } = await get("/models");
    expect(modelAccuracyResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("with scorecards imported", () => {
  beforeEach(() => {
    repos.scorecards.upsertMany([
      CARD,
      { ...CARD, horizonSeconds: 2700, predictions: 2412, maeSeconds: 140.0, biasSeconds: 11.5 },
      {
        ...CARD,
        modelVersion: "cascade-0.2.0",
        runId: "run-b",
        serviceDate: "2026-08-15",
        maeSeconds: 55.1,
      },
    ]);
  });

  it("groups by model version, so two versions can be compared", async () => {
    const { body } = await get("/models");

    expect(body.models.map((m: { modelVersion: string }) => m.modelVersion)).toEqual([
      "cascade-0.1.0",
      "cascade-0.2.0",
    ]);
  });

  it("weights a version's error by how many legs each horizon scored", async () => {
    // 7173 legs at 58.4s and 2412 at 140.0s is 78.9s, not the 99.2s a plain mean
    // of the two horizons would report.
    const { body } = await get("/models");
    const first = body.models.find((m: { modelVersion: string }) => m.modelVersion === "cascade-0.1.0");

    expect(first.maeSeconds).toBeCloseTo(78.93, 2);
    expect(first.predictions).toBe(9585);
  });

  it("keeps the per-horizon detail, since error grows with the horizon", async () => {
    const { body } = await get("/models");
    const first = body.models.find((m: { modelVersion: string }) => m.modelVersion === "cascade-0.1.0");

    expect(first.horizons.map((h: { horizonSeconds: number }) => h.horizonSeconds)).toEqual([
      270, 2700,
    ]);
    expect(first.horizons[1].maeSeconds).toBe(140.0);
  });

  it("names the runs and dates behind a version, so a number can be traced", async () => {
    const { body } = await get("/models");
    const first = body.models.find((m: { modelVersion: string }) => m.modelVersion === "cascade-0.1.0");

    expect(first.runIds).toEqual(["run-a"]);
    expect(first.serviceDates).toEqual(["2026-08-14"]);
  });

  it("narrows to one service date when asked", async () => {
    const { body } = await get("/models?date=2026-08-15");

    expect(body.serviceDate).toBe("2026-08-15");
    expect(body.models.map((m: { modelVersion: string }) => m.modelVersion)).toEqual([
      "cascade-0.2.0",
    ]);
  });

  it("rejects a malformed date rather than guessing", async () => {
    const { status } = await get("/models?date=last-tuesday");
    expect(status).toBe(400);
  });

  it("offers the dates that hold scorecards", async () => {
    const { body } = await get("/models");
    expect(body.availableDates).toEqual(["2026-08-14", "2026-08-15"]);
  });

  it("still validates against the contract the app checks every response with", async () => {
    const { body } = await get("/models");
    expect(modelAccuracyResponseSchema.safeParse(body).success).toBe(true);
  });
});
