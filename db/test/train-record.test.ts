import type { TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

/**
 * The two raw-event queries behind the train record and the delay certificate.
 * See README "Train record" and "Delay certificate".
 */

const NEC = "Northeast Corridor Line";

function event(overrides: Partial<TripStopEvent> = {}): TripStopEvent {
  return {
    tripId: "3928",
    routeId: "NE",
    lineName: NEC,
    stopId: "NYP",
    stopName: "New York Penn",
    stopSequence: 9,
    direction: "inbound",
    serviceDate: "2026-08-17",
    scheduledArrival: 1_786_000_000,
    scheduledDeparture: null,
    observedArrival: 1_786_000_300,
    delaySeconds: 300,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: 1_786_000_300_000,
    ...overrides,
  };
}

let repos: Repositories;

beforeEach(() => {
  repos = createRepositories(openDatabase());
});

describe("one departure's own history, run by run", () => {
  it("returns a row per service date it ran, newest last", () => {
    repos.events.recordMany([
      event({ serviceDate: "2026-08-17", delaySeconds: 60 }),
      event({ serviceDate: "2026-08-18", delaySeconds: 600 }),
      event({ serviceDate: "2026-08-19", delaySeconds: 120 }),
    ]);
    const runs = repos.events.runsAtStop("3928", "NYP", "2026-08-01", "2026-08-31");
    expect(runs.map((r) => r.serviceDate)).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(runs.map((r) => r.delaySeconds)).toEqual([60, 600, 120]);
  });

  it("honours the date range, so a rider can ask about the last month alone", () => {
    repos.events.recordMany([
      event({ serviceDate: "2026-07-01" }),
      event({ serviceDate: "2026-08-18" }),
    ]);
    const runs = repos.events.runsAtStop("3928", "NYP", "2026-08-01", "2026-08-31");
    expect(runs.map((r) => r.serviceDate)).toEqual(["2026-08-18"]);
  });

  it("reports a cancelled run rather than dropping it", () => {
    repos.events.recordMany([
      event({ serviceDate: "2026-08-18", delaySeconds: null, tripCancelled: true }),
    ]);
    const runs = repos.events.runsAtStop("3928", "NYP", "2026-08-01", "2026-08-31");
    expect(runs).toEqual([
      { serviceDate: "2026-08-18", delaySeconds: null, cancelled: true, skipped: false },
    ]);
  });

  it("keeps the run of a different trip out of this one's record", () => {
    repos.events.recordMany([
      event({ tripId: "3928", serviceDate: "2026-08-18", delaySeconds: 60 }),
      event({ tripId: "3930", serviceDate: "2026-08-18", delaySeconds: 900 }),
    ]);
    const runs = repos.events.runsAtStop("3928", "NYP", "2026-08-01", "2026-08-31");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.delaySeconds).toBe(60);
  });

  it("measures at the stop asked for, not whichever the trip reached first", () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4, delaySeconds: 60 }),
      event({ stopId: "NYP", stopSequence: 9, delaySeconds: 720 }),
    ]);
    expect(repos.events.runsAtStop("3928", "NWK", "2026-08-01", "2026-08-31")[0]?.delaySeconds).toBe(60);
    expect(repos.events.runsAtStop("3928", "NYP", "2026-08-01", "2026-08-31")[0]?.delaySeconds).toBe(720);
  });

  it("describes the trip once, so a screen can name it without a second query", () => {
    repos.events.recordMany([
      event({ stopId: "NWK", stopName: "Newark Penn", stopSequence: 4 }),
      event({ stopId: "NYP", stopName: "New York Penn", stopSequence: 9 }),
    ]);
    expect(repos.events.tripIdentity("3928")).toEqual({
      tripId: "3928",
      lineName: NEC,
      routeId: "NE",
      direction: "inbound",
      originStopId: "NWK",
      originStopName: "Newark Penn",
      terminalStopId: "NYP",
      terminalStopName: "New York Penn",
    });
  });

  it("has no identity for a trip it has never seen", () => {
    expect(repos.events.tripIdentity("nope")).toBeNull();
  });
});

describe("every observed arrival on a line on one date", () => {
  it("returns the arrival instant and delay, which is what banding needs", () => {
    repos.events.recordMany([
      event({ serviceDate: "2026-08-18", observedArrival: 1_786_000_300, delaySeconds: 300 }),
    ]);
    expect(repos.events.arrivalsOnDate(NEC, "2026-08-18")).toEqual([
      { tripId: "3928", observedArrival: 1_786_000_300, delaySeconds: 300 },
    ]);
  });

  it("omits a stop with no observed arrival, which carries no evidence either way", () => {
    repos.events.recordMany([
      event({ stopId: "A", observedArrival: null, delaySeconds: null }),
      event({ stopId: "B", observedArrival: 1_786_000_300, delaySeconds: 300 }),
    ]);
    expect(repos.events.arrivalsOnDate(NEC, "2026-08-17")).toHaveLength(1);
  });

  it("omits a skipped stop, where the scheduled arrival never happened", () => {
    repos.events.recordMany([event({ stopSkipped: true })]);
    expect(repos.events.arrivalsOnDate(NEC, "2026-08-17")).toEqual([]);
  });

  it("keeps another line's arrivals out of this line's certificate", () => {
    repos.events.recordMany([
      event({ lineName: NEC, stopId: "A" }),
      event({ lineName: "Morris & Essex Line", stopId: "B" }),
    ]);
    expect(repos.events.arrivalsOnDate(NEC, "2026-08-17")).toHaveLength(1);
  });

  it("lists the lines that ran on a date, so a screen can offer them", () => {
    repos.events.recordMany([
      event({ lineName: "Morris & Essex Line", stopId: "B" }),
      event({ lineName: NEC, stopId: "A" }),
    ]);
    expect(repos.events.lineNamesOnDate("2026-08-17")).toEqual(["Morris & Essex Line", NEC]);
  });
});
