import type { StationRankingAgg } from "@njt/db";
import { LOW_SAMPLE_THRESHOLD, type StationRanking, type StationRankingSort } from "@njt/shared";
import { round1 } from "./util";

/**
 * Rank stations so problems surface instead of hiding in an alphabetical list.
 *
 * Two very different questions get asked of a station, and they need separate
 * orderings:
 *
 *  - **delay**: how late are trains when they get here? Mostly inherited from
 *    up the line, so it says where riders *feel* delay.
 *  - **amplification**: how often does a train arrive on time and leave late?
 *    That is delay the station itself introduces — a dwell, platform or
 *    crewing problem — and it is the one an operator can actually fix.
 *
 * Ranking amplifies noise, so anything under the sample floor is withheld
 * rather than allowed to top a chart on a handful of observations.
 */

export interface StationNaming {
  stopName: string;
  lines: string[];
}

export function buildStationRankings(
  aggs: readonly StationRankingAgg[],
  naming: ReadonlyMap<string, StationNaming>,
  sort: StationRankingSort,
  limit: number,
): { stations: StationRanking[]; excludedLowSample: number } {
  const all = aggs
    .filter((a) => a.observations > 0)
    .map((a): StationRanking => {
      const named = naming.get(a.stopId);
      return {
        stopId: a.stopId,
        stopName: named?.stopName ?? a.stopId,
        lines: named?.lines ?? [],
        avgArrivalDelaySeconds: round1(a.sumArrivalDelaySeconds / a.observations),
        observations: a.observations,
        // Undefined rather than zero when no train arrived on time to amplify.
        amplificationRatePercent:
          a.arrivedWithin5Min > 0 ? round1((a.departedLateAfterOnTimeArrival / a.arrivedWithin5Min) * 100) : null,
        arrivedWithin5Min: a.arrivedWithin5Min,
        lowSample: a.observations < LOW_SAMPLE_THRESHOLD,
      };
    });

  const rankable = all.filter((s) => !s.lowSample && (sort === "delay" || s.amplificationRatePercent !== null));
  const excludedLowSample = all.length - rankable.length;

  const sorted = [...rankable].sort((a, b) =>
    sort === "amplification"
      ? (b.amplificationRatePercent ?? 0) - (a.amplificationRatePercent ?? 0)
      : b.avgArrivalDelaySeconds - a.avgArrivalDelaySeconds,
  );

  return { stations: sorted.slice(0, limit), excludedLowSample };
}
