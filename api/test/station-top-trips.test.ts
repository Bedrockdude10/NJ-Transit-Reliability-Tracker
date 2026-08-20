import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { worstTripsResponseSchema, type TripStopEvent } from "@njt/shared";
import { localPartsToEpochSeconds } from "@njt/shared/zoned";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * `GET /stations/:id/top-delayed-trips` — the list a rider picks a departure
 * from. See README "Train record".
 */

const NEC = "Northeast Corridor Line";
const RANGE = "from=2026-08-01&to=2026-08-31";

/** An instant at a local wall-clock time, which is what a timetable prints. */
function at(hour: number, minute: number, date = "2026-08-17"): number {
  const [year, month, day] = date.split("-").map(Number);
  return localPartsToEpochSeconds({
    year: year ?? 2026,
    month: month ?? 8,
    day: day ?? 17,
    hour,
    minute,
    second: 0,
  });
}

function event(overrides: Partial<TripStopEvent> = {}): TripStopEvent {
  return {
    tripId: "T1",
    routeId: "NE",
    lineName: NEC,
    stopId: "NWK",
    stopName: "Newark Penn",
    stopSequence: 4,
    direction: "inbound",
    serviceDate: "2026-08-17",
    scheduledArrival: at(7, 40),
    scheduledDeparture: at(7, 42),
    observedArrival: at(7, 50),
    delaySeconds: 600,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: at(7, 50) * 1000,
    ...overrides,
  };
}

/** The measured stop plus the trip's true last stop, which is what names it. */
function tripThrough(): TripStopEvent[] {
  return [
    event(),
    event({ stopId: "NYP", stopName: "New York Penn", stopSequence: 9, scheduledDeparture: null }),
  ];
}

let repos: Repositories;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  repos = createRepositories(openDatabase());
  app = createApp(repos, silentLogger);
});

const topTrips = async (stop = "NWK") => {
  const res = await app.request(`/stations/${stop}/top-delayed-trips?${RANGE}`);
  return { status: res.status, body: await res.json() };
};

describe("the departures worth checking at one station", () => {
  it("returns the shape the app validates", async () => {
    repos.events.recordMany(tripThrough());
    const { body } = await topTrips();
    expect(worstTripsResponseSchema.safeParse(body).success).toBe(true);
  });

  it("names where the train is going, not the station being measured", async () => {
    // The station's own name went in this field once, so every row on the
    // Newark list read "to Newark Penn".
    repos.events.recordMany(tripThrough());
    const { body } = await topTrips();
    expect(body.trips[0].terminalStopName).toBe("New York Penn");
  });

  it("carries the scheduled departure, which is how a rider names a train", async () => {
    repos.events.recordMany(tripThrough());
    const { body } = await topTrips();
    expect(body.trips[0].scheduledDepartureSeconds).toBe(at(7, 42));
  });

  it("falls back to the scheduled arrival where a stop has no departure time", async () => {
    repos.events.recordMany([event({ scheduledDeparture: null })]);
    const { body } = await topTrips();
    expect(body.trips[0].scheduledDepartureSeconds).toBe(at(7, 40));
  });

  it("takes the scheduled time from the newest run, so a retimed train reads current", async () => {
    repos.events.recordMany([
      event({ serviceDate: "2026-08-10", scheduledDeparture: at(7, 42, "2026-08-10") }),
      event({ serviceDate: "2026-08-18", scheduledDeparture: at(8, 15, "2026-08-18") }),
    ]);
    const { body } = await topTrips();
    expect(body.trips[0].scheduledDepartureSeconds).toBe(at(8, 15, "2026-08-18"));
  });

  it("reports no scheduled time rather than inventing one when the feed had neither", async () => {
    repos.events.recordMany([event({ scheduledDeparture: null, scheduledArrival: null })]);
    const { body } = await topTrips();
    expect(body.trips[0].scheduledDepartureSeconds).toBeNull();
  });
});
