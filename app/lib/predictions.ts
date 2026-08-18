import type { PredictedDelay, PredictionProvenance, PredictionsResponse } from "@njt/shared";
import { formatDelayShort, formatDurationShort, formatInt } from "./format";

/**
 * A signed duration: `+1m 0s`, `−1m 0s`, `0s`, or `—` when unknown.
 *
 * The minus is U+2212, not a hyphen, so it aligns with digits in a table.
 */
export function signedSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds === 0) return "0s";
  const magnitude = formatDurationShort(seconds);
  return seconds > 0 ? `+${magnitude}` : `−${magnitude}`;
}

export function accuracyNote(response: PredictionsResponse): string {
  const { meanAbsoluteErrorSeconds, scoredCount } = response;
  if (meanAbsoluteErrorSeconds === null || scoredCount === 0) {
    return "Not yet checked against what happened — no trips on this date have finished.";
  }
  const trips =
    scoredCount === 1 ? "1 trip that has run" : `${formatInt(scoredCount)} trips that have run`;
  return `Off by ${formatDurationShort(meanAbsoluteErrorSeconds)} on average, across ${trips}.`;
}

/** Run id is truncated to eight characters — enough to find the run in MLflow. */
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

export function formatPredictedDelay(leg: PredictedDelay): string {
  if (leg.interval === null) return formatDelayShort(leg.predictedDelaySeconds);
  // En dash, not a hyphen: these values can be negative, and "−2m-3m" is unreadable.
  return `${formatDelayShort(leg.interval.lowerSeconds)}–${formatDelayShort(leg.interval.upperSeconds)}`;
}

/** Null when no leg carries an interval; names each coverage if a run mixes them. */
export function intervalNote(predictions: readonly PredictedDelay[]): string | null {
  const percents = [...new Set(predictions.map((p) => p.interval?.percent).filter((p) => p !== undefined))];
  if (percents.length === 0) return null;
  const coverage = percents.sort((a, b) => a - b).join("% / ");
  return `Ranges are ${coverage}% prediction intervals: the model expects the actual delay to fall inside them that often.`;
}
