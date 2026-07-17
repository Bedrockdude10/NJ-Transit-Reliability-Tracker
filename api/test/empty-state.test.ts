import { createRepositories, openDatabase } from "@njt/db";
import type {
  HealthResponse,
  LineListResponse,
  LineSummaryResponse,
  MapResponse,
  StationListResponse,
  StationSummaryResponse,
  SystemSummaryResponse,
} from "@njt/shared";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * The state the deployed product actually runs in: no independent measurement
 * has accrued yet (the live GTFS-Realtime feed is honestly sparse/empty, and
 * NJT's monthly figures may not cover the requested window). Every endpoint must
 * return 200 with a well-formed *empty* DTO — never a 500, and never a shape the
 * frontend can't render. The seeded happy-path is covered by app.test.ts; this
 * locks the empty path so a regression can't ship a dashboard that crashes on
 * first load.
 */

const RANGE = "from=2025-01-01&to=2025-12-31";

/** Every GET the frontend issues, with the params it sends. */
const ENDPOINTS: string[] = [
  "/",
  "/health",
  `/system/summary?${RANGE}`,
  `/system/heatmap?type=hour_of_day&${RANGE}`,
  `/system/heatmap?type=day_of_week&${RANGE}`,
  "/system/history",
  "/lines",
  `/map?${RANGE}`,
  `/lightrail/summary?${RANGE}`,
  `/lines/NE/summary?${RANGE}`,
  `/lines/NE/trend?interval=daily&${RANGE}`,
  `/lines/NE/trend?interval=weekly&${RANGE}`,
  "/lines/NE/monthly",
  "/lines/NE/history",
  `/lines/NE/trips/worst?${RANGE}`,
  `/lines/NE/heatmap?type=hour_of_day&${RANGE}`,
  "/stations",
  `/stations/NWK/summary?${RANGE}`,
  `/stations/NWK/top-delayed-trips?${RANGE}`,
  `/connections?inbound_trip_id=T1&transfer_stop_id=NWK&outbound_trip_id=T2&${RANGE}`,
  `/connections/top?${RANGE}`,
  `/alerts?${RANGE}`,
  `/alerts/frequency?${RANGE}`,
  `/export?entity=system&${RANGE}`,
  `/export?entity=line&id=NE&${RANGE}`,
];

/** A DB with the GTFS network loaded (production runs getGTFS at startup) but
 *  zero measurement — the realistic steady state before/while the feed accrues. */
function networkOnlyApp(): Hono {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c1", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: "Northeast Corridor Line", color: "DD3439" }]);
  repos.gtfs.replaceStops("v1", [
    { stopId: "NWK", stopName: "Newark Penn", stopLat: 40.7347, stopLon: -74.1644 },
    { stopId: "NYP", stopName: "New York Penn", stopLat: 40.7506, stopLon: -73.9936 },
  ]);
  repos.gtfs.replaceTrips("v1", [{ tripId: "T1", routeId: "NE", directionId: 0 }]);
  repos.gtfs.replaceStopTimes("v1", [
    { tripId: "T1", stopId: "NWK", stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:01:00" },
    { tripId: "T1", stopId: "NYP", stopSequence: 2, arrivalTime: "08:20:00", departureTime: "08:21:00" },
  ]);
  return createApp(repos);
}

function bareApp(): Hono {
  return createApp(createRepositories(openDatabase()));
}

describe("empty database (before any GTFS or measurement)", () => {
  const app = bareApp();

  it.each(ENDPOINTS)("GET %s returns 200, not a 500", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
  });

  it("GET /health reports no collection has started", async () => {
    const body = (await (await app.request("/health")).json()) as HealthResponse;
    expect(body.collectionStartDate).toBeNull();
    expect(Array.isArray(body.feeds)).toBe(true);
  });

  it("GET /lines and /map are empty, not erroring", async () => {
    const lines = (await (await app.request("/lines")).json()) as LineListResponse;
    const map = (await (await app.request(`/map?${RANGE}`)).json()) as MapResponse;
    expect(lines.lines).toEqual([]);
    expect(map.stations).toEqual([]);
    expect(map.lines).toEqual([]);
  });

  it("GET /system/summary is a zeroed summary with no NJT figures", async () => {
    const body = (await (await app.request(`/system/summary?${RANGE}`)).json()) as SystemSummaryResponse;
    expect(body.overall.tripsOperated).toBe(0);
    expect(body.overall.thresholds.every((t) => t.otpPercent === 0)).toBe(true);
    expect(body.overall.delayDistribution.length).toBeGreaterThan(0); // labelled buckets, all zero
    expect(body.overall.delayDistribution.every((b) => b.count === 0)).toBe(true);
    expect(body.njtOfficial).toBeNull();
    expect(body.njtCancellations).toBeNull();
    expect(body.fleetMdbf).toBeNull();
  });

  it("line- and station-scoped endpoints return empty (resolveLine is tolerant, never 404)", async () => {
    const line = (await (await app.request(`/lines/NE/summary?${RANGE}`)).json()) as LineSummaryResponse;
    expect(line.overall.tripsOperated).toBe(0);
    expect(line.inbound.tripsOperated).toBe(0);
    expect(line.outbound.tripsOperated).toBe(0);
    expect(line.njtOfficial).toBeNull();

    const station = (await (await app.request(`/stations/NWK/summary?${RANGE}`)).json()) as StationSummaryResponse;
    expect(station.byLineDirection).toEqual([]);
    expect(station.amplification.amplificationRatePercent).toBe(0);
  });
});

describe("network present, no measurement yet (steady-state production)", () => {
  const app = networkOnlyApp();

  it.each(ENDPOINTS)("GET %s returns 200, not a 500", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
  });

  it("lists the network while measurement stays empty", async () => {
    const lines = (await (await app.request("/lines")).json()) as LineListResponse;
    expect(lines.lines.map((l) => l.id)).toContain("NE");
    // The network is known, but there is no independent OTP or NJT figure yet.
    expect(lines.lines[0]?.njtOtpPercent).toBeNull();

    const stations = (await (await app.request("/stations")).json()) as StationListResponse;
    expect(stations.stations.map((s) => s.stopId)).toEqual(expect.arrayContaining(["NWK", "NYP"]));

    const summary = (await (await app.request(`/lines/NE/summary?${RANGE}`)).json()) as LineSummaryResponse;
    expect(summary.name).toBe("Northeast Corridor Line");
    expect(summary.overall.tripsOperated).toBe(0);
  });

  it("GET /map returns geometry with null reliability (no OTP to color by)", async () => {
    const map = (await (await app.request(`/map?${RANGE}`)).json()) as MapResponse;
    expect(map.stations.length).toBeGreaterThan(0);
    const ne = map.lines.find((l) => l.lineId === "NE");
    expect(ne?.path.length).toBeGreaterThan(0);
    expect(ne?.njtOtpPercent).toBeNull();
    expect(ne?.projectOtpPercent15Min).toBeNull();
  });
});
