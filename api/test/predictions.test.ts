import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { type DelayPrediction, predictionsResponseSchema } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * `GET /predictions` — model output, or an honest statement that there is none.
 *
 * The state that matters most here is the empty one. No model has run yet, and
 * this project publishes no synthetic data, so the endpoint has to say "nothing
 * predicted" in a way a screen can render without it looking like a failure.
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
let repos: Repositories;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDatabase();
  repos = createRepositories(db);
  repos.gtfs.insertVersion({
    versionId: "v1",
    effectiveFrom: 0,
    effectiveTo: null,
    checksum: "c",
    ingestedAtMs: 0,
  });
  repos.gtfs.replaceStops("v1", [
    { stopId: "105", stopName: "Newark Penn Station" },
    { stopId: "107", stopName: "New York Penn Station" },
  ]);
  app = createApp(repos, silentLogger);
});

const get = async (path: string) => {
  const response = await app.request(path);
  return { status: response.status, body: await response.json() };
};

describe("with no model run yet", () => {
  it("says so, rather than failing or inventing a number", async () => {
    const { status, body } = await get("/predictions?date=2026-08-14");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      serviceDate: "2026-08-14",
      available: false,
      predictions: [],
      provenance: null,
      meanAbsoluteErrorSeconds: null,
      scoredCount: 0,
      availableDates: [],
    });
  });

  it("still satisfies the response contract the app validates against", async () => {
    // The app parses every response with this schema; an empty state that fails
    // it would crash the screen it exists to keep calm.
    const { body } = await get("/predictions?date=2026-08-14");
    expect(predictionsResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe("with predictions imported", () => {
  beforeEach(() => {
    repos.predictions.upsertMany([PREDICTION]);
  });

  it("returns them with station names, not the ids the model works in", async () => {
    const { body } = await get("/predictions?date=2026-08-14");

    expect(body.available).toBe(true);
    expect(body.predictions).toEqual([
      {
        tripId: "T1",
        lineName: "Northeast Corridor",
        fromStopName: "Newark Penn Station",
        toStopName: "New York Penn Station",
        horizonSeconds: 1800,
        predictedDelaySeconds: 240,
        actualDelaySeconds: null,
        errorSeconds: null,
      },
    ]);
  });

  it("names the model and run that produced them", async () => {
    // A forecast with no provenance invites more confidence than it has earned.
    const { body } = await get("/predictions?date=2026-08-14");
    expect(body.provenance).toEqual({
      modelVersion: "lgbm-0.1.0",
      runId: "run-a",
      predictedAtEpochSeconds: PREDICTION.predictedAtEpochSeconds,
    });
  });

  it("scores only the legs whose actual is known", async () => {
    // Predictions are written before the trip runs, so most of a day has no
    // actual yet. Treating a missing actual as zero would flatter the model.
    repos.predictions.upsertMany([
      { ...PREDICTION, tripId: "T2", predictedDelaySeconds: 100, actualDelaySeconds: 160 },
      { ...PREDICTION, tripId: "T3", predictedDelaySeconds: 300, actualDelaySeconds: 240 },
    ]);

    const { body } = await get("/predictions?date=2026-08-14");
    expect(body.scoredCount).toBe(2);
    expect(body.meanAbsoluteErrorSeconds).toBe(60);
  });

  it("reports error signed, so optimism is distinguishable from caution", async () => {
    // A model that is reliably 60s optimistic is a different problem from one
    // that is reliably 60s cautious, and the absolute error hides which.
    repos.predictions.upsertMany([
      { ...PREDICTION, tripId: "T2", predictedDelaySeconds: 100, actualDelaySeconds: 160 },
    ]);
    const { body } = await get("/predictions?date=2026-08-14");
    const scored = body.predictions.find((p: { tripId: string }) => p.tripId === "T2");
    expect(scored.errorSeconds).toBe(60);
  });

  it("offers the dates that do hold predictions", async () => {
    repos.predictions.upsertMany([{ ...PREDICTION, serviceDate: "2026-08-15" }]);
    const { body } = await get("/predictions?date=2026-08-01");
    expect(body.available).toBe(false);
    expect(body.availableDates).toEqual(["2026-08-14", "2026-08-15"]);
  });

  it("defaults to the most recent predicted date when none is asked for", async () => {
    // The useful default: a screen with no date in the URL should show the newest
    // thing there is rather than today, which is usually empty.
    repos.predictions.upsertMany([{ ...PREDICTION, serviceDate: "2026-08-15" }]);
    const { body } = await get("/predictions");
    expect(body.serviceDate).toBe("2026-08-15");
    expect(body.available).toBe(true);
  });

  it("falls back to the stop id when a station is not in the GTFS version", async () => {
    // Missing geometry should degrade to something identifiable, not blank.
    repos.predictions.upsertMany([{ ...PREDICTION, tripId: "T9", toStopId: "999" }]);
    const { body } = await get("/predictions?date=2026-08-14");
    const unknown = body.predictions.find((p: { tripId: string }) => p.tripId === "T9");
    expect(unknown.toStopName).toBe("999");
  });

  it("rejects a malformed date rather than guessing", async () => {
    expect((await get("/predictions?date=not-a-date")).status).toBe(400);
  });
});
