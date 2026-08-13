import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../src/clock";
import { loadConfig } from "../src/config";
import type { FeedClient } from "../src/feeds";
import { Ingestor } from "../src/ingestor";
import { silentLogger } from "../src/logger";
import { RateLimiter } from "../src/rate-limiter";

const { transit_realtime: tr } = GtfsRealtimeBindings;
const NOW = Date.UTC(2025, 6, 15, 12, 0, 0);
const fixedClock: Clock = { now: () => NOW, sleep: () => Promise.resolve() };

function tripUpdatesBytes(): Uint8Array {
  return tr.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "1",
        tripUpdate: {
          trip: { tripId: "T1", routeId: "NE", startDate: "20250715", directionId: 1 },
          stopTimeUpdate: [
            { stopId: "NWK", stopSequence: 1, arrival: { time: 1752580920, delay: 120 } },
            { stopId: "NYP", stopSequence: 2, arrival: { time: 1752582000, delay: 300 } },
          ],
        },
      },
    ],
  }).finish();
}

class FakeClient implements FeedClient {
  failTripUpdates = false;
  fetchTripUpdates(): Promise<Uint8Array> {
    return this.failTripUpdates ? Promise.reject(new Error("boom")) : Promise.resolve(tripUpdatesBytes());
  }
  fetchServiceAlerts(): Promise<Uint8Array> {
    return Promise.resolve(tr.FeedMessage.encode({ header: { gtfsRealtimeVersion: "2.0" }, entity: [] }).finish());
  }
  vehiclePositionsBytes: Uint8Array = new Uint8Array();
  fetchVehiclePositions(): Promise<Uint8Array> {
    return Promise.resolve(this.vehiclePositionsBytes);
  }
}

function vehiclePositionsBytes(): Uint8Array {
  return tr.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0" },
    entity: [
      {
        id: "e1",
        vehicle: {
          vehicle: { id: "V1" },
          trip: { tripId: "T1", routeId: "NE", startDate: "20250715", directionId: 1 },
          position: { latitude: 40.7347, longitude: -74.1645 },
          stopId: "NWK",
          timestamp: 1752580900,
        },
      },
    ],
  }).finish();
}

function setup(client: FakeClient) {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line" }]);
  repos.gtfs.replaceStops("v1", [
    { stopId: "NWK", stopName: "Newark Penn" },
    { stopId: "NYP", stopName: "New York Penn" },
  ]);
  repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 1 }]);
  repos.gtfs.replaceStopTimes("v1", [
    { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
    { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "08:20:00", departureTime: "08:21:00" },
  ]);
  const config = loadConfig({});
  const ingestor = new Ingestor({ repos, client, config, rateLimiter: new RateLimiter(repos.health), clock: fixedClock, logger: silentLogger });
  return { repos, ingestor };
}

describe("Ingestor", () => {
  let client: FakeClient;
  let repos: Repositories;
  let ingestor: Ingestor;
  beforeEach(() => {
    client = new FakeClient();
    ({ repos, ingestor } = setup(client));
  });

  it("ingests TripUpdates: stores a snapshot, events, health, and budget", async () => {
    const ok = await ingestor.pollTripUpdates();
    expect(ok).toBe(true);
    expect(repos.events.count()).toBe(2);
    expect(repos.snapshots.count("TripUpdates")).toBe(1);
    expect(repos.health.feedHealth(NOW).find((f) => f.feedType === "TripUpdates")?.lastSuccessAtMs).toBe(NOW);
    expect(repos.health.budgetUsed("gtfs_rt", NOW)).toBe(1);
    expect(repos.health.collectionStartDate()).toBe("2025-07-15");
  });

  it("records a failure and writes nothing when the fetch fails", async () => {
    client.failTripUpdates = true;
    const ok = await ingestor.pollTripUpdates();
    expect(ok).toBe(false);
    expect(repos.events.count()).toBe(0);
    expect(repos.snapshots.count("TripUpdates")).toBe(0);
    const feed = repos.health.feedHealth(NOW).find((f) => f.feedType === "TripUpdates");
    expect(feed?.lastFailureAtMs).toBe(NOW);
    expect(feed?.lastSuccessAtMs).toBeNull();
  });

  it("recomputes aggregates from ingested events", async () => {
    await ingestor.pollTripUpdates();
    ingestor.recompute("2025-07-15");
    const otp = repos.aggregates.getOtpDailyRows("system", "system", "all", "2025-07-15", "2025-07-15");
    expect(otp[0]?.tripsOperated).toBe(1); // one trip, terminal delay 300
    expect(otp[0]?.onTimeCounts["300"]).toBe(1);
  });

  it("ingests VehiclePositions: archives the snapshot and stores parsed positions", async () => {
    client.vehiclePositionsBytes = vehiclePositionsBytes();
    expect(await ingestor.pollVehiclePositions()).toBe(true);

    expect(repos.snapshots.count("VehiclePositions")).toBe(1);
    const [v] = repos.vehicles.all();
    expect(v).toMatchObject({
      vehicleId: "V1",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      stopId: "NWK",
      stopName: "Newark Penn",
      ingestedAtMs: NOW,
    });
  });

  it("swaps the vehicle snapshot wholesale so departed trains drop off", async () => {
    client.vehiclePositionsBytes = vehiclePositionsBytes();
    await ingestor.pollVehiclePositions();
    expect(repos.vehicles.count()).toBe(1);

    // An empty feed body is a valid "no active vehicles" poll.
    client.vehiclePositionsBytes = new Uint8Array();
    expect(await ingestor.pollVehiclePositions()).toBe(true);
    expect(repos.vehicles.count()).toBe(0);
  });

  // Regression: recordFailure runs inside the catch block, so when a concurrent
  // writer holds the lock it threw *from the error handler*, escaped the catch,
  // rejected the scheduler tick and killed the process — taking the supervisor
  // and the whole machine down. A failed poll must degrade, never crash.
  it("survives a failed poll whose failure-recording also fails", async () => {
    client.failTripUpdates = true;
    repos.health.recordFailure = () => {
      throw new Error("database is locked");
    };

    await expect(ingestor.pollTripUpdates()).resolves.toBe(false);
  });

  it("still ingests on the next tick after a locked-database poll", async () => {
    client.failTripUpdates = true;
    const original = repos.health.recordFailure.bind(repos.health);
    repos.health.recordFailure = () => {
      throw new Error("database is locked");
    };
    await ingestor.pollTripUpdates();

    repos.health.recordFailure = original;
    client.failTripUpdates = false;
    expect(await ingestor.pollTripUpdates()).toBe(true);
    expect(repos.events.count()).toBeGreaterThan(0);
  });

  it("flags staleness when TripUpdates has been silent too long", async () => {
    await ingestor.pollTripUpdates(); // last success at NOW
    const lateClock: Clock = { now: () => NOW + 2 * 3_600_000, sleep: () => Promise.resolve() };
    const late = new Ingestor({ repos, client, config: loadConfig({}), rateLimiter: new RateLimiter(repos.health), clock: lateClock, logger: silentLogger });
    expect(await late.checkStaleness()).toBe(true);
  });
});
