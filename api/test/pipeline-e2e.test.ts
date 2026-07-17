import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { recomputeServiceDate } from "@njt/pipeline";
import type { LineSummaryResponse, OtpSummary, SystemSummaryResponse, WorstTripsResponse } from "@njt/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * End-to-end across the pipeline→db→api seam: raw (GTFS-RT-derived) events →
 * the pipeline's REAL `recomputeServiceDate` (which runs `computeAggregates` and
 * persists the daily rows) → the API summing those rows into DTOs.
 *
 * app.test.ts seeds daily rows *directly*, so nothing there proves the
 * aggregator's write shape and the API's read shape actually agree. This does:
 * the OTP percentages, direction split, and worst-trip ranking below are derived
 * end-to-end from the raw events, not hand-written. It deliberately imports
 * `@njt/pipeline` to exercise both producers of the daily-row contract at once.
 */

const DATE = "2025-03-10";
const NEC = "Northeast Corridor Line";
const SEEN = Date.UTC(2025, 2, 10, 12, 0, 0);
const BASE = Math.floor(SEEN / 1000);

const STATIONS = {
  NWK: { stopId: "NWK", stopName: "Newark Penn" },
  NYP: { stopId: "NYP", stopName: "New York Penn" },
} as const;

function seededRepos(): Repositories {
  const repos = createRepositories(openDatabase());
  repos.gtfs.insertVersion({ versionId: "v1", effectiveFrom: 0, effectiveTo: null, checksum: "c1", ingestedAtMs: 0 });
  repos.gtfs.replaceRoutes("v1", [{ routeId: "NE", lineName: NEC, color: "DD3439" }]);
  repos.gtfs.replaceStops("v1", [
    { ...STATIONS.NWK, stopLat: 40.7347, stopLon: -74.1644 },
    { ...STATIONS.NYP, stopLat: 40.7506, stopLon: -73.9936 },
  ]);
  return repos;
}

/**
 * Record a two-stop trip whose terminal (last) stop carries `terminalDelay` —
 * the value OTP is computed from. Inbound runs NWK→NYP, outbound NYP→NWK.
 */
function recordTrip(
  repos: Repositories,
  tripId: string,
  direction: "inbound" | "outbound",
  terminalDelay: number | null,
  cancelled = false,
): void {
  const path = direction === "inbound" ? [STATIONS.NWK, STATIONS.NYP] : [STATIONS.NYP, STATIONS.NWK];
  path.forEach((stop, i) => {
    const isTerminal = i === path.length - 1;
    const delay = cancelled ? null : isTerminal ? terminalDelay : 0;
    repos.events.record({
      tripId,
      routeId: "NE",
      lineName: NEC,
      stopId: stop.stopId,
      stopName: stop.stopName,
      stopSequence: i + 1,
      direction,
      serviceDate: DATE,
      scheduledArrival: BASE + (i + 1) * 600,
      scheduledDeparture: BASE + (i + 1) * 600 + 60,
      observedArrival: delay === null ? null : BASE + (i + 1) * 600 + delay,
      delaySeconds: delay,
      stopSkipped: false,
      tripCancelled: cancelled,
      gtfsStaticVersion: "v1",
      ingestedAtMs: SEEN,
    });
  });
}

const otpAt = (s: OtpSummary, sec: number) => s.thresholds.find((t) => t.thresholdSeconds === sec)?.otpPercent;

/** Ingest raw events, run the real pipeline recompute, and serve the result. */
function buildApp() {
  const repos = seededRepos();
  // 3 operated trips (terminal delays 120s, 700s, 2000s) + 1 cancelled.
  recordTrip(repos, "T1", "inbound", 120);
  recordTrip(repos, "T2", "inbound", 700);
  recordTrip(repos, "T3", "outbound", 2000);
  recordTrip(repos, "T4", "inbound", null, true);
  // The REAL pipeline path: read events → computeAggregates → persist rows.
  recomputeServiceDate(repos, DATE);
  return createApp(repos);
}

describe("pipeline → db → api end-to-end", () => {
  const app = buildApp();
  const getJson = async <T>(path: string): Promise<T> => (await app.request(path)).json() as Promise<T>;

  it("derives system OTP from the persisted aggregates", async () => {
    const body = await getJson<SystemSummaryResponse>(`/system/summary?from=${DATE}&to=${DATE}`);
    expect(body.overall.tripsOperated).toBe(3);
    expect(body.overall.tripsCancelled).toBe(1);
    expect(body.overall.cancellationRatePercent).toBe(25); // 1 of 4 scheduled
    expect(otpAt(body.overall, 300)).toBe(33.3); // only the 120s trip
    expect(otpAt(body.overall, 900)).toBe(66.7); // 120s + 700s
    expect(otpAt(body.overall, 3600)).toBe(100); // all three
    expect(body.overall.avgDelaySeconds).toBe(940); // (120+700+2000)/3
  });

  it("splits OTP by direction end-to-end", async () => {
    const body = await getJson<LineSummaryResponse>(`/lines/NE/summary?from=${DATE}&to=${DATE}`);
    expect(body.name).toBe(NEC);
    expect(body.overall.tripsOperated).toBe(3);
    expect(body.inbound.tripsOperated).toBe(2); // T1, T2
    expect(body.outbound.tripsOperated).toBe(1); // T3
  });

  it("ranks worst trips from the aggregator's per-trip rows (cancelled excluded)", async () => {
    const body = await getJson<WorstTripsResponse>(`/lines/NE/trips/worst?from=${DATE}&to=${DATE}`);
    expect(body.trips.map((t) => t.tripId)).toEqual(["T3", "T2", "T1"]);
    expect(body.trips[0]?.avgTerminalDelaySeconds).toBe(2000);
  });
});
