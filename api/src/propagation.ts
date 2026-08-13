import type { StationDelayAgg } from "@njt/db";
import type { PropagationSegment, PropagationStop } from "@njt/shared";
import { round1 } from "./util";

/**
 * Where along a route delay comes from.
 *
 * A line's headline OTP says *whether* it runs late; it cannot say *where* the
 * lateness enters. Laying average delay out in running order turns that into an
 * operational question: which segment adds the minutes, and where do trains
 * make them back.
 *
 * The measure is average delay per stop differenced along the route, not
 * per-train tracking. That's deliberate: it's computed from daily aggregates
 * the pipeline already writes, so a year of history answers instantly instead
 * of scanning the event table. The cost is that it describes the *typical*
 * train rather than following any individual one.
 */

export interface OrderedStop {
  stopId: string;
  stopName: string;
}

export function buildPropagation(
  orderedStops: readonly OrderedStop[],
  delays: readonly StationDelayAgg[],
): PropagationStop[] {
  const byStop = new Map(delays.map((d) => [d.stopId, d]));
  const stops: PropagationStop[] = [];
  let previousAvg: number | null = null;

  for (const [i, s] of orderedStops.entries()) {
    const agg = byStop.get(s.stopId);
    const avg = agg && agg.observations > 0 ? round1(agg.sumArrivalDelaySeconds / agg.observations) : null;

    // Only difference against a stop that actually had a measurement: carrying
    // the last known value across a gap would attribute someone else's delay
    // to the wrong segment.
    const delta = avg !== null && previousAvg !== null ? round1(avg - previousAvg) : null;

    stops.push({
      stopId: s.stopId,
      stopName: s.stopName,
      sequence: i + 1,
      avgDelaySeconds: avg,
      observations: agg?.observations ?? 0,
      deltaSeconds: delta,
    });
    if (avg !== null) previousAvg = avg;
  }

  return stops;
}

/** Rank consecutive pairs by delay added (or, negated, by delay recovered). */
export function rankSegments(stops: readonly PropagationStop[], limit: number): {
  worstSegments: PropagationSegment[];
  bestRecoveries: PropagationSegment[];
} {
  const segments: PropagationSegment[] = [];
  for (let i = 1; i < stops.length; i++) {
    const to = stops[i] as PropagationStop;
    if (to.deltaSeconds === null) continue;
    // Attribute the change to the segment ending here, naming the previous
    // *measured* stop rather than the previous listed one.
    const fromStop = [...stops.slice(0, i)].reverse().find((s) => s.avgDelaySeconds !== null);
    if (!fromStop) continue;
    segments.push({ fromStopName: fromStop.stopName, toStopName: to.stopName, addedSeconds: to.deltaSeconds });
  }

  const worstSegments = segments.filter((s) => s.addedSeconds > 0).sort((a, b) => b.addedSeconds - a.addedSeconds).slice(0, limit);
  const bestRecoveries = segments.filter((s) => s.addedSeconds < 0).sort((a, b) => a.addedSeconds - b.addedSeconds).slice(0, limit);
  return { worstSegments, bestRecoveries };
}

/** Net delay accumulated end to end, using the first and last measured stops. */
export function netAccumulated(stops: readonly PropagationStop[]): number | null {
  const measured = stops.filter((s) => s.avgDelaySeconds !== null);
  if (measured.length < 2) return null;
  const first = measured[0] as PropagationStop;
  const last = measured[measured.length - 1] as PropagationStop;
  return round1((last.avgDelaySeconds as number) - (first.avgDelaySeconds as number));
}
