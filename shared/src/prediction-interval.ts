/**
 * Reading the optional prediction interval off a {@link DelayPrediction}.
 *
 * The three fields are optional individually — that is what keeps a point-only
 * day valid — but meaningless individually. A generated schema cannot say "all
 * three or none", so the rule lives here and is applied at import.
 *
 * Kept out of `predictions.ts`, which stays import-free so ts-to-zod can read it.
 */

import type { PredictionInterval } from "./api";
import type { DelayPrediction } from "./predictions";

const PARTS = [
  "predictedDelayLowerSeconds",
  "predictedDelayUpperSeconds",
  "predictionIntervalPercent",
] as const;

/**
 * Why this prediction's interval is unusable, or null when it is fine — which
 * includes carrying no interval at all. A point estimate outside its own
 * interval is almost always the two having been computed in different units.
 */
export function intervalProblem(prediction: DelayPrediction): string | null {
  const present = PARTS.filter((part) => prediction[part] !== undefined);
  if (present.length === 0) return null;
  if (present.length < PARTS.length) {
    const missing = PARTS.filter((part) => prediction[part] === undefined);
    return `has a partial prediction interval: ${present.join(", ")} present, ${missing.join(", ")} missing`;
  }

  const lower = prediction.predictedDelayLowerSeconds!;
  const upper = prediction.predictedDelayUpperSeconds!;
  const percent = prediction.predictionIntervalPercent!;

  if (!(lower <= upper)) {
    return `has an inverted prediction interval: lower ${lower}s is above upper ${upper}s`;
  }
  if (!(percent > 0 && percent < 100)) {
    return `has a prediction interval confidence of ${percent}%, which must be between 0 and 100 exclusive`;
  }
  if (prediction.predictedDelaySeconds < lower || prediction.predictedDelaySeconds > upper) {
    return (
      `has a point estimate of ${prediction.predictedDelaySeconds}s outside its own ` +
      `${percent}% interval of ${lower}s to ${upper}s — check that both are in seconds`
    );
  }
  return null;
}

/**
 * Null when the prediction carries no interval, and also when it carries an
 * incoherent one: a stored prediction already passed {@link intervalProblem} at
 * import, and showing no range is the safe failure on a screen.
 */
export function predictionInterval(prediction: DelayPrediction): PredictionInterval | null {
  if (intervalProblem(prediction) !== null) return null;
  if (prediction.predictedDelayLowerSeconds === undefined) return null;
  return {
    lowerSeconds: prediction.predictedDelayLowerSeconds,
    upperSeconds: prediction.predictedDelayUpperSeconds!,
    percent: prediction.predictionIntervalPercent!,
  };
}
