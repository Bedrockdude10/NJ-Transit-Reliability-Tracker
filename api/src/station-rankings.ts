import type { StationRankingAgg } from "@njt/db";
import { LOW_SAMPLE_THRESHOLD, type StationRanking, type StationRankingSort } from "@njt/shared";
import { round1 } from "./util";

/**
 * `delay` is mostly inherited from up the line — where riders feel it.
 * `amplification` is how often a train arrives on time and leaves late — delay
 * the station itself introduces. Under the sample floor, both are withheld.
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
