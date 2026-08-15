import type { PredictedDelay, PredictionProvenance, PredictionsResponse } from "@njt/shared";
import { formatDelayShort, formatDurationShort, formatInt } from "./format";

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

/**
 * A predicted delay as a range where the model gave one, a point where it did not.
 *
 * The range is the more honest answer. "8m" reads as though the model knows the
 * arrival to the minute; "5m–12m" says what it actually claims, which is a band
 * it expects to be right about most of the time. So the range replaces the point
 * rather than sitting beside it — showing both invites reading the point as the
 * real answer and the range as decoration.
 */
export function formatPredictedDelay(leg: PredictedDelay): string {
  if (leg.interval === null) return formatDelayShort(leg.predictedDelaySeconds);
  // An en dash, not a hyphen: these are numbers that can be negative, and
  // "−2m-3m" is unreadable.
  return `${formatDelayShort(leg.interval.lowerSeconds)}–${formatDelayShort(leg.interval.upperSeconds)}`;
}

/**
 * What the ranges on screen mean, stated once under the table rather than on
 * every row.
 *
 * A range without its confidence is not a claim — "5 to 12 minutes late" is a
 * different statement at 50% than at 95% — but repeating "(80%)" on forty rows
 * is noise that stops being read. Returns null when no leg shown carries an
 * interval, and names each coverage when a run somehow mixes them.
 */
export function intervalNote(predictions: readonly PredictedDelay[]): string | null {
  const percents = [...new Set(predictions.map((p) => p.interval?.percent).filter((p) => p !== undefined))];
  if (percents.length === 0) return null;
  const coverage = percents.sort((a, b) => a - b).join("% / ");
  return `Ranges are ${coverage}% prediction intervals: the model expects the actual delay to fall inside them that often.`;
}
