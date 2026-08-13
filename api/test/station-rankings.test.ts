import type { StationRankingAgg } from "@njt/db";
import { describe, expect, it } from "vitest";
import { buildStationRankings, type StationNaming } from "../src/station-rankings";

const naming = new Map<string, StationNaming>([
  ["A", { stopName: "Newark Penn", lines: ["Northeast Corridor Line"] }],
  ["B", { stopName: "Secaucus Junction", lines: ["Main/Bergen County Line"] }],
  ["C", { stopName: "Hoboken", lines: ["Morris & Essex Line"] }],
]);

function agg(overrides: Partial<StationRankingAgg> & { stopId: string }): StationRankingAgg {
  return {
    sumArrivalDelaySeconds: 12_000,
    observations: 100,
    arrivedWithin5Min: 80,
    departedLateAfterOnTimeArrival: 8,
    ...overrides,
  };
}

describe("buildStationRankings", () => {
  it("ranks by arrival delay when asked for delay", () => {
    const { stations } = buildStationRankings(
      [
        agg({ stopId: "A", sumArrivalDelaySeconds: 6_000 }),
        agg({ stopId: "B", sumArrivalDelaySeconds: 30_000 }),
        agg({ stopId: "C", sumArrivalDelaySeconds: 12_000 }),
      ],
      naming,
      "delay",
      10,
    );
    expect(stations.map((s) => s.stopName)).toEqual(["Secaucus Junction", "Hoboken", "Newark Penn"]);
    expect(stations[0]?.avgArrivalDelaySeconds).toBe(300);
  });

  // Delay is mostly inherited from up the line; amplification is what the
  // station itself adds, so the two orderings answer different questions.
  it("ranks by amplification when asked, producing a different order", () => {
    const rows = [
      agg({ stopId: "A", sumArrivalDelaySeconds: 30_000, arrivedWithin5Min: 100, departedLateAfterOnTimeArrival: 5 }),
      agg({ stopId: "B", sumArrivalDelaySeconds: 6_000, arrivedWithin5Min: 100, departedLateAfterOnTimeArrival: 40 }),
    ];
    expect(buildStationRankings(rows, naming, "delay", 10).stations[0]?.stopName).toBe("Newark Penn");
    expect(buildStationRankings(rows, naming, "amplification", 10).stations[0]?.stopName).toBe("Secaucus Junction");
  });

  it("withholds thin samples rather than letting them top the chart", () => {
    const { stations, excludedLowSample } = buildStationRankings(
      [agg({ stopId: "A", observations: 3, sumArrivalDelaySeconds: 99_999 }), agg({ stopId: "B" })],
      naming,
      "delay",
      10,
    );
    expect(stations.map((s) => s.stopName)).toEqual(["Secaucus Junction"]);
    expect(excludedLowSample).toBe(1);
  });

  it("reports amplification as unknown, not zero, with no on-time arrivals", () => {
    const { stations } = buildStationRankings([agg({ stopId: "A", arrivedWithin5Min: 0 })], naming, "delay", 10);
    expect(stations[0]?.amplificationRatePercent).toBeNull();
  });

  it("excludes stations with no amplification figure from the amplification ranking", () => {
    const { stations } = buildStationRankings(
      [agg({ stopId: "A", arrivedWithin5Min: 0 }), agg({ stopId: "B" })],
      naming,
      "amplification",
      10,
    );
    expect(stations.map((s) => s.stopName)).toEqual(["Secaucus Junction"]);
  });

  it("skips stations with no observations at all", () => {
    expect(buildStationRankings([agg({ stopId: "A", observations: 0 })], naming, "delay", 10).stations).toEqual([]);
  });

  it("falls back to the stop id when the station is not in the catalog", () => {
    const { stations } = buildStationRankings([agg({ stopId: "ZZZ" })], naming, "delay", 10);
    expect(stations[0]).toMatchObject({ stopName: "ZZZ", lines: [] });
  });

  it("honours the limit", () => {
    const rows = ["A", "B", "C"].map((stopId) => agg({ stopId }));
    expect(buildStationRankings(rows, naming, "delay", 2).stations).toHaveLength(2);
  });
});
