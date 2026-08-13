import type { StationDelayAgg } from "@njt/db";
import { describe, expect, it } from "vitest";
import { buildPropagation, netAccumulated, rankSegments, summarizePropagation } from "../src/propagation";

const stops = [
  { stopId: "A", stopName: "Trenton" },
  { stopId: "B", stopName: "Princeton Junction" },
  { stopId: "C", stopName: "New Brunswick" },
  { stopId: "D", stopName: "Newark Penn" },
];

const delay = (stopId: string, avg: number, observations = 100): StationDelayAgg => ({
  stopId,
  sumArrivalDelaySeconds: avg * observations,
  observations,
});

describe("buildPropagation", () => {
  it("lays delay out in running order with per-segment change", () => {
    const result = buildPropagation(stops, [delay("A", 60), delay("B", 120), delay("C", 90), delay("D", 300)]);
    expect(result.map((s) => [s.stopName, s.avgDelaySeconds, s.deltaSeconds])).toEqual([
      ["Trenton", 60, null],
      ["Princeton Junction", 120, 60],
      ["New Brunswick", 90, -30],
      ["Newark Penn", 300, 210],
    ]);
  });

  it("reports a stop with no observations rather than omitting it", () => {
    const result = buildPropagation(stops, [delay("A", 60), delay("D", 300)]);
    expect(result.map((s) => s.stopName)).toHaveLength(4);
    expect(result[1]).toMatchObject({ stopName: "Princeton Junction", avgDelaySeconds: null, observations: 0 });
  });

  // Carrying a stale value across a gap would blame the wrong segment.
  it("differences against the last measured stop, skipping unmeasured ones", () => {
    const result = buildPropagation(stops, [delay("A", 60), delay("D", 300)]);
    expect(result[1]?.deltaSeconds).toBeNull();
    expect(result[2]?.deltaSeconds).toBeNull();
    expect(result[3]?.deltaSeconds).toBe(240); // D vs A, not D vs C
  });

  it("treats a stop with zero observations as unmeasured, not as zero delay", () => {
    const result = buildPropagation(stops, [delay("A", 0, 0)]);
    expect(result[0]?.avgDelaySeconds).toBeNull();
  });
});

describe("rankSegments", () => {
  it("ranks the costliest stretches and the best recoveries separately", () => {
    const built = buildPropagation(stops, [delay("A", 60), delay("B", 200), delay("C", 100), delay("D", 400)]);
    const { worstSegments, bestRecoveries } = rankSegments(built, 5);

    expect(worstSegments[0]).toMatchObject({ fromStopName: "New Brunswick", toStopName: "Newark Penn", addedSeconds: 300 });
    expect(worstSegments[1]).toMatchObject({ fromStopName: "Trenton", toStopName: "Princeton Junction", addedSeconds: 140 });
    expect(bestRecoveries[0]).toMatchObject({ fromStopName: "Princeton Junction", toStopName: "New Brunswick", addedSeconds: -100 });
  });

  it("names the previous measured stop, not the previous listed one", () => {
    const built = buildPropagation(stops, [delay("A", 60), delay("D", 300)]);
    expect(rankSegments(built, 5).worstSegments[0]).toMatchObject({ fromStopName: "Trenton", toStopName: "Newark Penn" });
  });

  it("honours the limit", () => {
    const built = buildPropagation(stops, [delay("A", 10), delay("B", 20), delay("C", 30), delay("D", 40)]);
    expect(rankSegments(built, 1).worstSegments).toHaveLength(1);
  });
});

describe("netAccumulated", () => {
  it("measures end to end across the measured stops", () => {
    const built = buildPropagation(stops, [delay("A", 60), delay("D", 300)]);
    expect(netAccumulated(built)).toBe(240);
  });

  it("returns null when a single stop cannot describe accumulation", () => {
    expect(netAccumulated(buildPropagation(stops, [delay("A", 60)]))).toBeNull();
    expect(netAccumulated(buildPropagation(stops, []))).toBeNull();
  });
});

describe("summarizePropagation", () => {
  const build = (avgs: number[]) => buildPropagation(stops, stops.map((s, i) => delay(s.stopId, avgs[i] as number)));

  it("says when there is too little to trace", () => {
    const s = buildPropagation(stops, [delay("A", 60)]);
    expect(summarizePropagation({ lineName: "NEC", stops: s, netAccumulatedSeconds: null, worstSegments: [] })).toContain(
      "Not enough measured stops",
    );
  });

  it("distinguishes losing time from making it back", () => {
    const losing = build([60, 120, 180, 300]);
    expect(
      summarizePropagation({ lineName: "NEC", stops: losing, netAccumulatedSeconds: 240, worstSegments: [] }),
    ).toContain("lose about 4 minutes");

    const recovering = build([300, 240, 120, 60]);
    expect(
      summarizePropagation({ lineName: "NEC", stops: recovering, netAccumulatedSeconds: -240, worstSegments: [] }),
    ).toContain("make back about 4 minutes");
  });

  it("uses singular prose for one minute", () => {
    const s = build([0, 30, 45, 60]);
    expect(summarizePropagation({ lineName: "NEC", stops: s, netAccumulatedSeconds: 60, worstSegments: [] })).toContain(
      "1 minute end to end",
    );
  });

  it("calls a route that neither gains nor sheds delay what it is", () => {
    const s = build([120, 118, 121, 119]);
    expect(summarizePropagation({ lineName: "NEC", stops: s, netAccumulatedSeconds: -1, worstSegments: [] })).toContain(
      "finish roughly as late as they start",
    );
  });
});
