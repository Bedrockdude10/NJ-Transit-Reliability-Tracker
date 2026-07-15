import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { OfficialNjtMetric } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { listLines, listStations, resolveLine, stopName, toLineItem } from "../src/catalog";

function metric(o: Partial<OfficialNjtMetric>): OfficialNjtMetric {
  return {
    month: 6,
    year: 2025,
    lineName: "Northeast Corridor Line",
    otpPercent: 91.5,
    otpPercentAmtrakAdjusted: null,
    tripsOperated: 970,
    cancellations: 30,
    cancellationCauses: null,
    ...o,
  };
}

describe("toLineItem", () => {
  it("enriches a catalog line with the latest NJT month", () => {
    const item = toLineItem("NE", "Northeast Corridor Line", metric({}), "ee0000");
    expect(item).toMatchObject({
      id: "NE",
      slug: "northeast-corridor",
      shortName: "NEC",
      hasAmtrakAttribution: true,
      color: "ee0000",
      njtOtpPercent: 91.5,
      njtLatestMonth: "2025-06",
    });
    // 30 cancelled of (970 + 30) scheduled = 3.0%
    expect(item.njtCancellationRatePercent).toBe(3);
  });

  it("falls back to a slug + the name when the line is not in the catalog", () => {
    const item = toLineItem("XX", "Some Unknown Branch", null);
    expect(item).toMatchObject({
      slug: "some-unknown-branch",
      shortName: "Some Unknown Branch",
      hasAmtrakAttribution: false,
      color: null,
      njtOtpPercent: null,
      njtCancellationRatePercent: null,
      njtLatestMonth: null,
    });
  });

  it("reports a null cancellation rate when nothing was scheduled", () => {
    const item = toLineItem("NE", "Northeast Corridor Line", metric({ tripsOperated: 0, cancellations: 0 }));
    expect(item.njtCancellationRatePercent).toBeNull();
  });
});

describe("repository-backed catalog helpers", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  function seedGtfs(): string {
    repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
    repos.gtfs.replaceRoutes("v1", [
      { routeId: "NE", lineName: "Northeast Corridor Line", color: "ee0000" },
      { routeId: "HBLR", lineName: "Hudson-Bergen Light Rail", mode: "light_rail" },
    ]);
    repos.gtfs.replaceStops("v1", [
      { stopId: "NWK", stopName: "Newark Penn" },
      { stopId: "NYP", stopName: "New York Penn" },
    ]);
    repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
    repos.gtfs.replaceStopTimes("v1", [
      { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
      { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "08:20:00", departureTime: null },
    ]);
    return "v1";
  }

  it("listLines returns [] before any GTFS is ingested", () => {
    expect(listLines(repos)).toEqual([]);
    expect(listStations(repos)).toEqual([]);
  });

  it("listLines excludes light rail and enriches with official history", () => {
    seedGtfs();
    repos.official.upsert(metric({ month: 5, otpPercent: 90 }));
    repos.official.upsert(metric({ month: 6, otpPercent: 92 }));
    const lines = listLines(repos);
    expect(lines.map((l) => l.id)).toEqual(["NE"]); // light rail dropped
    expect(lines[0]).toMatchObject({ njtOtpPercent: 92, njtLatestMonth: "2025-06", color: "ee0000" });
  });

  it("resolveLine prefers GTFS, then the reference catalog, then the id itself", () => {
    seedGtfs();
    expect(resolveLine(repos, "NE")).toEqual({ routeId: "NE", name: "Northeast Corridor Line" });
    // Not in GTFS but a known catalog default route id.
    expect(resolveLine(repos, "PV").name).toBe("Pascack Valley Line");
    // Entirely unknown → echoes the id.
    expect(resolveLine(repos, "ZZZ")).toEqual({ routeId: "ZZZ", name: "ZZZ" });
  });

  it("resolveLine echoes the id when there is no GTFS version at all", () => {
    expect(resolveLine(repos, "NE").name).toBe("Northeast Corridor Line"); // via catalog
    expect(resolveLine(repos, "made-up")).toEqual({ routeId: "made-up", name: "made-up" });
  });

  it("listStations maps route ids to human line names", () => {
    seedGtfs();
    const stations = listStations(repos);
    const nwk = stations.find((s) => s.stopId === "NWK");
    expect(nwk?.lines).toEqual(["Northeast Corridor Line"]);
  });

  it("stopName resolves a name, falling back to the raw id", () => {
    seedGtfs();
    expect(stopName(repos, "NWK")).toBe("Newark Penn");
    expect(stopName(repos, "UNKNOWN")).toBe("UNKNOWN");
  });

  it("stopName falls back to the id when no GTFS version exists", () => {
    expect(stopName(repos, "NWK")).toBe("NWK");
  });
});
