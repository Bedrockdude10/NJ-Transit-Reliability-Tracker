/**
 * Reading the optional prediction interval off a {@link DelayPrediction}.
 *
 * The three interval fields are optional individually — that is what keeps a
 * point-only day valid — but they are meaningless individually: a bound with no
 * confidence attached is not a claim, and a confidence with no bounds is not a
 * range. The generated contract schema cannot say "all three or none", because
 * it is generated from an interface and an interface has no room for it. So the
 * rule lives here, applied at the seam where model output is imported.
 *
 * Kept out of `predictions.ts`, which stays import-free so ts-to-zod can read it.
 */

import type { PredictionInterval } from "./api";
import type { DelayPrediction } from "./predictions";

/** The three fields that only mean anything together. */
const PARTS = [
  "predictedDelayLowerSeconds",
  "predictedDelayUpperSeconds",
  "predictionIntervalPercent",
] as const;

/**
 * Why this prediction's interval is unusable, or null when it is fine — which
 * includes carrying no interval at all.
 *
 * The containment check is the one worth explaining. A point estimate outside
 * its own interval is not a model being unusual; it is almost always the bounds
 * and the point having been computed in different units, which is precisely the
 * mistake that reached production once already and the one thing here that
 * would otherwise render as a confident, wrong range on a rider's screen.
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
 * The interval as the API serves it, or null when the prediction carries none.
 *
 * Returns null rather than throwing on an incoherent interval: by the time
 * anything reads a stored prediction it has already passed
 * {@link intervalProblem} at import, and a screen is the wrong place to discover
 * otherwise. Showing no range is the safe failure.
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
