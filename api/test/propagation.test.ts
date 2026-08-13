import type { StationDelayAgg } from "@njt/db";
import { describe, expect, it } from "vitest";
import { buildPropagation, netAccumulated, rankSegments } from "../src/propagation";

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
