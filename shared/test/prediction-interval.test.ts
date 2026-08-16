import { describe, expect, it } from "vitest";
import type { DelayPrediction } from "../src/predictions";
import { intervalProblem, predictionInterval } from "../src/prediction-interval";

function prediction(overrides: Partial<DelayPrediction> = {}): DelayPrediction {
  return {
    tripId: "1234",
    lineName: "Northeast Corridor",
    serviceDate: "2026-08-14",
    fromStopId: "105",
    toStopId: "107",
    predictedAtEpochSeconds: 1_776_000_000,
    horizonSeconds: 1_800,
    predictedDelaySeconds: 480,
    actualDelaySeconds: null,
    modelVersion: "lgbm-2026.08",
    runId: "abc123def456",
    ...overrides,
  };
}

const withInterval = (lower: number, upper: number, percent: number) =>
  prediction({
    predictedDelayLowerSeconds: lower,
    predictedDelayUpperSeconds: upper,
    predictionIntervalPercent: percent,
  });

describe("intervalProblem", () => {
  it("accepts a prediction with no interval at all — the point-only model stays valid", () => {
    expect(intervalProblem(prediction())).toBeNull();
  });

  it("accepts a coherent interval around the point estimate", () => {
    expect(intervalProblem(withInterval(300, 720, 80))).toBeNull();
  });

  it("accepts an interval that touches the point estimate at a bound", () => {
    expect(intervalProblem(withInterval(480, 720, 80))).toBeNull();
  });

  it("rejects bounds published without a confidence", () => {
    const partial = prediction({ predictedDelayLowerSeconds: 300, predictedDelayUpperSeconds: 720 });
    expect(intervalProblem(partial)).toMatch(/partial prediction interval/);
    expect(intervalProblem(partial)).toMatch(/predictionIntervalPercent missing/);
  });

  it("rejects a confidence published without bounds", () => {
    expect(intervalProblem(prediction({ predictionIntervalPercent: 80 }))).toMatch(
      /partial prediction interval/,
    );
  });

  it("rejects an inverted interval", () => {
    expect(intervalProblem(withInterval(720, 300, 80))).toMatch(/inverted/);
  });

  it.each([0, 100, -5, 150])("rejects a confidence of %s%%", (percent) => {
    expect(intervalProblem(withInterval(300, 720, percent))).toMatch(/between 0 and 100/);
  });

  /**
   * The unit mixup, caught. Bounds in minutes beside a point in seconds passes
   * every type and every schema check; it fails here because 480 seconds does
   * not lie between 5 and 12.
   */
  it("rejects bounds that do not contain their own point estimate", () => {
    const mixed = withInterval(5, 12, 80);
    expect(intervalProblem(mixed)).toMatch(/outside its own 80% interval/);
    expect(intervalProblem(mixed)).toMatch(/check that both are in seconds/);
  });

  it("rejects a point estimate above the upper bound too", () => {
    expect(intervalProblem(withInterval(0, 60, 80))).toMatch(/outside its own/);
  });
});

describe("predictionInterval", () => {
  it("returns null when the prediction carries no interval", () => {
    expect(predictionInterval(prediction())).toBeNull();
  });

  it("returns the interval as the API serves it", () => {
    expect(predictionInterval(withInterval(300, 720, 80))).toEqual({
      lowerSeconds: 300,
      upperSeconds: 720,
      percent: 80,
    });
  });

  it("shows no range rather than a wrong one when the stored interval is incoherent", () => {
    expect(predictionInterval(withInterval(720, 300, 80))).toBeNull();
  });
});
