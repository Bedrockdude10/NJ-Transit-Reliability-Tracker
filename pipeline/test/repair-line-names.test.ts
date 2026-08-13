import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { UNKNOWN_LINE_NAME, type TripStopEvent } from "@njt/shared";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { loadGtfsStatic } from "../src/gtfs-static/load";
import { repairLineNames } from "../src/gtfs/repair-line-names";

// Mirrors the real getGTFS feed: numeric source route ids that collapse onto
// canonical catalog lines (10 -> NC, 6 -> MN).
const FILES = {
  "routes.txt":
    "route_id,route_long_name,route_short_name,route_type,route_color\n" +
    "10,North Jersey Coast Line,NJCL,113,00A1DE\n" +
    "6,Main Line,MAIN,113,FFD411\n",
  "trips.txt": "trip_id,route_id,service_id,direction_id,trip_headsign\nT1,10,WK,1,Bay Head\n",
  "stop_times.txt": "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT1,1,1,08:00:00,08:01:00\n",
  "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n1,Aberdeen-Matawan,40.42,-74.22\n",
};

const SERVICE_DATE = "2026-07-15";

function event(overrides: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "RT1",
    routeId: "10",
    lineName: "10",
    stopId: "1",
    stopName: "Aberdeen-Matawan",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: SERVICE_DATE,
    scheduledArrival: 1000,
    scheduledDeparture: 1060,
    observedArrival: 1120,
    delaySeconds: 120,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("repairLineNames", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    loadGtfsStatic(repos, zipSync(Object.fromEntries(Object.entries(FILES).map(([n, c]) => [n, strToU8(c)]))));
  });

  it("repoints events stored under a raw route id onto the canonical line", () => {
    repos.events.record(event({ tripId: "RT1" }));
    repos.events.record(event({ tripId: "RT2", routeId: "6", lineName: "6" }));

    const result = repairLineNames(repos);

    const byName = Object.fromEntries(result.relabelled.map((r) => [r.from, r]));
    expect(byName["10"]).toMatchObject({ to: "North Jersey Coast Line", routeId: "NC", events: 1 });
    expect(byName["6"]).toMatchObject({ to: "Main/Bergen County Line", routeId: "MN", events: 1 });

    const stored = repos.events.getByServiceDate(SERVICE_DATE);
    expect(stored.map((e) => e.lineName).sort()).toEqual(["Main/Bergen County Line", "North Jersey Coast Line"]);
    expect(repos.events.distinctLineNames()).not.toContain("10");
  });

  it("recomputes the affected days so station aggregates stop showing the raw id", () => {
    repos.events.record(event({}));
    // The corrupted aggregate the bug produced: a station reporting a line "10".
    repos.aggregates.replaceServiceDate(SERVICE_DATE, {
      otp: [],
      distribution: [],
      heatmap: [],
      trips: [],
      stationDaily: [
        {
          stopId: "1",
          serviceDate: SERVICE_DATE,
          lineName: "10",
          direction: "inbound",
          sumArrivalDelaySeconds: 120,
          observations: 1,
          arrivedWithin5Min: 1,
          departedLateAfterOnTimeArrival: 0,
        },
      ],
      stationHourly: [],
      stationDistribution: [],
      connections: [],
    });
    expect(repos.aggregates.stationByLineDirection("1", SERVICE_DATE, SERVICE_DATE)[0]?.lineName).toBe("10");

    const result = repairLineNames(repos);

    expect(result.serviceDatesRecomputed).toEqual([SERVICE_DATE]);
    const rebuilt = repos.aggregates.stationByLineDirection("1", SERVICE_DATE, SERVICE_DATE);
    expect(rebuilt.map((r) => r.lineName)).toEqual(["North Jersey Coast Line"]);
  });

  it("marks genuinely unresolvable ids unknown rather than leaving a fake line", () => {
    repos.events.record(event({ routeId: "999", lineName: "999" }));

    const result = repairLineNames(repos);

    expect(result.relabelled).toEqual([{ from: "999", to: UNKNOWN_LINE_NAME, routeId: "999", events: 1 }]);
    expect(repos.events.distinctLineNames()).toEqual([UNKNOWN_LINE_NAME]);
  });

  it("leaves already-correct events alone and is safe to re-run", () => {
    repos.events.record(event({ routeId: "NC", lineName: "North Jersey Coast Line" }));

    expect(repairLineNames(repos).relabelled).toEqual([]);
    expect(repairLineNames(repos).relabelled).toEqual([]);
    expect(repos.events.distinctLineNames()).toEqual(["North Jersey Coast Line"]);
  });

  // Production regression: Port Jervis is its own route in some NJT feeds and
  // folded into the Main Line in others. Judging "real line" against only the
  // *current* version relabelled 9,000 genuine Port Jervis events to "Unknown
  // line" and overwrote their route_id with the line name.
  it("leaves a catalog line alone when it is absent from the current GTFS version", () => {
    repos.events.record(event({ tripId: "PJ1", routeId: "PJ", lineName: "Port Jervis Line" }));

    const result = repairLineNames(repos);

    expect(result.relabelled).toEqual([]);
    const [stored] = repos.events.getByServiceDate(SERVICE_DATE);
    expect(stored).toMatchObject({ routeId: "PJ", lineName: "Port Jervis Line" });
  });

  it("restores events whose route_id was overwritten with a line name", () => {
    // The shape the buggy run left behind.
    repos.events.record(event({ tripId: "PJ1", routeId: "Port Jervis Line", lineName: UNKNOWN_LINE_NAME }));

    const result = repairLineNames(repos);

    const [stored] = repos.events.getByServiceDate(SERVICE_DATE);
    expect(stored).toMatchObject({ routeId: "PJ", lineName: "Port Jervis Line" });
    expect(result.serviceDatesRecomputed).toContain(SERVICE_DATE);
  });

  // Relabelling commits per statement, so a run that dies during the recompute
  // leaves clean events and stranded aggregates — and the old re-run found
  // nothing to do while the site kept serving the stale names.
  it("resumes when events are already clean but aggregates are stale", () => {
    repos.events.record(event({ routeId: "NC", lineName: "North Jersey Coast Line" }));
    repos.aggregates.replaceServiceDate(SERVICE_DATE, {
      otp: [], distribution: [], heatmap: [], trips: [], stationHourly: [], stationDistribution: [], connections: [],
      stationDaily: [
        {
          stopId: "1", serviceDate: SERVICE_DATE, lineName: "10", direction: "inbound",
          sumArrivalDelaySeconds: 120, observations: 1, arrivedWithin5Min: 1, departedLateAfterOnTimeArrival: 0,
        },
      ],
    });

    const result = repairLineNames(repos);

    expect(result.relabelled).toEqual([]); // nothing left in the events
    expect(result.serviceDatesRecomputed).toEqual([SERVICE_DATE]); // but the day is rebuilt
    expect(repos.aggregates.stationByLineDirection("1", SERVICE_DATE, SERVICE_DATE).map((r) => r.lineName)).toEqual([
      "North Jersey Coast Line",
    ]);
  });

  // Replay resolves each snapshot against the schedule effective at the time,
  // so a *historical* version without aliases makes it relabel real trips
  // "Unknown line" — undoing this repair. Every version must be covered.
  it("backfills aliases for superseded versions, not just the current one", () => {
    const fresh = createRepositories(openDatabase());
    for (const [versionId, from] of [["old", 0], ["current", 1000]] as const) {
      fresh.gtfs.insertVersion({ versionId, effectiveFrom: from, effectiveTo: null, checksum: versionId, ingestedAtMs: 0 });
      fresh.gtfs.storeFile(versionId, "routes.txt", strToU8(FILES["routes.txt"]));
    }
    fresh.gtfs.replaceRoutes("current", [{ routeId: "NC", lineName: "North Jersey Coast Line", mode: "rail" }]);

    repairLineNames(fresh);

    expect(fresh.gtfs.canonicalRouteFor("old", "10")).toBe("NC");
    expect(fresh.gtfs.canonicalRouteFor("current", "10")).toBe("NC");
  });

  it("leaves a version alone when its routes.txt was never archived", () => {
    const fresh = createRepositories(openDatabase());
    fresh.gtfs.insertVersion({ versionId: "no-files", effectiveFrom: 0, effectiveTo: null, checksum: "x", ingestedAtMs: 0 });
    expect(repairLineNames(fresh).aliasesBackfilled).toBe(0);
  });

  it("backfills route aliases from the archived routes.txt when the table is empty", () => {
    // A version as ingested *before* the alias table existed: routes, the
    // archived raw files, and no aliases.
    const fresh = createRepositories(openDatabase());
    const versionId = "v-legacy";
    fresh.gtfs.insertVersion({ versionId, effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
    fresh.gtfs.replaceRoutes(versionId, [
      { routeId: "NC", lineName: "North Jersey Coast Line", mode: "rail" },
      { routeId: "MN", lineName: "Main/Bergen County Line", mode: "rail" },
    ]);
    fresh.gtfs.storeFile(versionId, "routes.txt", strToU8(FILES["routes.txt"]));
    expect(fresh.gtfs.routeAliases(versionId)).toEqual([]);

    fresh.events.record(event({}));
    const result = repairLineNames(fresh);

    expect(result.aliasesBackfilled).toBe(2);
    expect(fresh.gtfs.canonicalRouteFor(versionId, "10")).toBe("NC");
    expect(fresh.gtfs.canonicalRouteFor(versionId, "6")).toBe("MN");
    // ...and the backfilled map is what lets the repair resolve the events.
    expect(result.relabelled).toEqual([
      { from: "10", to: "North Jersey Coast Line", routeId: "NC", events: 1 },
    ]);
  });
});
