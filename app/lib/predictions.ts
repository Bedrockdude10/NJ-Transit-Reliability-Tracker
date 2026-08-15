import type { PredictedDelay, PredictionProvenance, PredictionsResponse } from "@njt/shared";
import { formatDurationShort, formatInt } from "./format";

/**
 * Wording for model output.
 *
 * Every other number on this site is observed. These are guesses, and the panel
 * has to read like one — which is mostly a matter of leading with how wrong the
 * model has been rather than with what it predicts.
 */

/**
 * A signed duration: `+1m 0s`, `−1m 0s`, `0s`, or `—` when unknown.
 *
 * Signed because the direction of a miss is the substance. A model that is
 * reliably optimistic sends people to a platform to wait; one that is reliably
 * cautious sends them to an earlier train they did not need. An absolute value
 * hides which of those a model does.
 *
 * The minus is U+2212, not a hyphen, so it aligns with digits in a table.
 */
export function signedSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds === 0) return "0s";
  const magnitude = formatDurationShort(seconds);
  return seconds > 0 ? `+${magnitude}` : `−${magnitude}`;
}

/**
 * The headline: how wrong the model has been, not how confident it is.
 *
 * A day that is still ahead has predictions and no way to check them, and saying
 * anything about accuracy there would be inventing it.
 */
export function accuracyNote(response: PredictionsResponse): string {
  const { meanAbsoluteErrorSeconds, scoredCount } = response;
  if (meanAbsoluteErrorSeconds === null || scoredCount === 0) {
    return "Not yet checked against what happened — no trips on this date have finished.";
  }
  const trips =
    scoredCount === 1 ? "1 trip that has run" : `${formatInt(scoredCount)} trips that have run`;
  return `Off by ${formatDurationShort(meanAbsoluteErrorSeconds)} on average, across ${trips}.`;
}

/**
 * What produced these numbers.
 *
 * The run id is truncated to eight characters: long enough to find the run in
 * MLflow, short enough to read aloud.
 */
export function provenanceNote(provenance: PredictionProvenance | null): string | null {
  if (!provenance) return null;
  return `Model ${provenance.modelVersion}, run ${provenance.runId.slice(0, 8)}`;
}

/** Legs grouped under their line, each group in the order the API returned. */
export function byLine(
  predictions: readonly PredictedDelay[],
): { lineName: string; legs: PredictedDelay[] }[] {
  const groups = new Map<string, PredictedDelay[]>();
  for (const leg of predictions) {
    const existing = groups.get(leg.lineName);
    if (existing) existing.push(leg);
    else groups.set(leg.lineName, [leg]);
  }
  return [...groups].map(([lineName, legs]) => ({ lineName, legs }));
}
