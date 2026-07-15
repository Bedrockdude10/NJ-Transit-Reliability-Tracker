import type {
  AlertFrequencyResponse,
  AlertListResponse,
  ConnectionResponse,
  ConnectionTopResponse,
  HealthResponse,
  HeatmapResponse,
  HistoryResponse,
  LightRailSummaryResponse,
  LineListResponse,
  LineMonthlyResponse,
  LineSummaryResponse,
  LineTrendResponse,
  MapResponse,
  StationListResponse,
  StationSummaryResponse,
  SystemSummaryResponse,
  WorstTripsResponse,
} from "@njt/shared";
import { createRepositories, openDatabase } from "@njt/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app";
import { SEED_DATE, seededApp } from "./seed";

const RANGE = `from=${SEED_DATE}&to=${SEED_DATE}`;

describe("API integration", () => {
  let app: Hono;
  beforeEach(() => {
    app = seededApp().app;
  });

  const getJson = async <T>(path: string): Promise<{ status: number; body: T }> => {
    const res = await app.request(path);
    return { status: res.status, body: (await res.json()) as T };
  };

  it("serves the root with a disclaimer header", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-NJT-Disclaimer")).toContain("Independent of NJT");
  });

  it("GET /health reports collection state", async () => {
    const { body } = await getJson<HealthResponse>("/health");
    expect(body.collectionStartDate).toBe("2025-07-01");
    const tripUpdates = body.feeds.find((f) => f.feedType === "TripUpdates");
    expect(tripUpdates?.lastSuccessAtMs).toBe(Date.UTC(2025, 6, 15, 12, 0, 0));
  });

  it("GET /system/summary shows OTP gap vs NJT official", async () => {
    const { body } = await getJson<SystemSummaryResponse>(`/system/summary?${RANGE}`);
    expect(body.overall.tripsOperated).toBe(100);
    expect(body.overall.thresholds.find((t) => t.thresholdSeconds === 300)?.otpPercent).toBe(70);
    expect(body.njtOfficial?.otpPercent).toBe(88.5); // the gap the project exists to show
    expect(body.njtOfficial?.thresholdSeconds).toBe(360);
    expect(body.fleetMdbf).toMatchObject({ avgMiles: 90000, monthsCovered: 1 });
    expect(body.njtCancellations?.total).toBe(50);
    expect(body.njtCancellations?.byCause[0]).toEqual({ cause: "AMTRAK", count: 30, percent: 60 });
  });

  it("GET /system/heatmap labels day-of-week buckets", async () => {
    const { body } = await getJson<HeatmapResponse>(`/system/heatmap?type=day_of_week&${RANGE}`);
    expect(body.buckets.find((b) => b.bucket === 2)).toMatchObject({ label: "Tue", avgDelaySeconds: 60 });
  });

  it("rejects a bad heatmap type and malformed dates", async () => {
    expect((await app.request(`/system/heatmap?type=nope&${RANGE}`)).status).toBe(400);
    expect((await app.request(`/system/summary?from=bad`)).status).toBe(400);
  });

  it("GET /lines lists active lines with NJT's latest reported OTP", async () => {
    const { body } = await getJson<LineListResponse>("/lines");
    expect(body.lines).toEqual([
      {
        id: "NE",
        slug: "northeast-corridor",
        name: "Northeast Corridor Line",
        shortName: "NEC",
        hasAmtrakAttribution: true,
        color: "DD3439",
        njtOtpPercent: 88.5,
        njtCancellationRatePercent: 1.6, // 50 / (3000 + 50)
        njtLatestMonth: "2025-07",
      },
    ]);
  });

  it("GET /map returns real geometry + per-line reliability", async () => {
    const { body } = await getJson<MapResponse>("/map?from=2025-07-01&to=2025-07-31");
    expect(body.stations.find((s) => s.stopId === "NWK")).toMatchObject({ stopName: "Newark Penn", lat: 40.7347 });
    const nec = body.lines.find((l) => l.lineId === "NE");
    expect(nec).toMatchObject({ color: "DD3439", njtOtpPercent: 88.5, projectOtpPercent15Min: 92 });
    expect(nec?.path).toEqual(["NWK", "NYP"]);
  });

  it("GET /lines/:id/summary includes direction split and official figures", async () => {
    const { body } = await getJson<LineSummaryResponse>(`/lines/NE/summary?${RANGE}`);
    expect(body.overall.tripsOperated).toBe(100);
    expect(body.inbound.tripsOperated).toBe(50);
    expect(body.outbound.tripsOperated).toBe(50);
    expect(body.njtOfficial?.otpPercentAmtrakAdjusted).toBe(91.2);
    expect(body.njtCancellations?.total).toBe(50);
    expect(body.njtCancellations?.byCause[0]).toEqual({ cause: "AMTRAK", count: 30, percent: 60 });
  });

  it("GET /lines/:id/trend plots 15-min OTP with NJT's monthly figure", async () => {
    const { body } = await getJson<LineTrendResponse>(`/lines/NE/trend?interval=daily&${RANGE}`);
    expect(body.points).toHaveLength(1);
    expect(body.points[0]?.otpPercent15Min).toBe(92);
    expect(body.points[0]?.njtOfficialOtpPercent).toBe(88.5);
  });

  it("GET /lines/:id/monthly merges real NJT months with project months", async () => {
    const { body } = await getJson<LineMonthlyResponse>("/lines/NE/monthly");
    const july = body.rows.find((r) => r.month === "2025-07");
    expect(july).toMatchObject({
      njtOtpPercent: 88.5,
      njtOtpPercentAmtrakAdjusted: 91.2,
      projectOtpPercent15Min: 92, // onTime@900 (92) / operated (100)
    });
  });

  it("GET /lines/:id/trips/worst ranks by terminal delay", async () => {
    const { body } = await getJson<WorstTripsResponse>(`/lines/NE/trips/worst?${RANGE}`);
    expect(body.trips[0]).toMatchObject({ tripId: "T1", avgTerminalDelaySeconds: 1200 });
  });

  it("GET /lines/:id/heatmap returns average-delay cells for the line", async () => {
    const { body } = await getJson<HeatmapResponse>(`/lines/NE/heatmap?${RANGE}`);
    expect(body.type).toBe("hour_of_day");
    expect(body.buckets.find((b) => b.bucket === 8)?.avgDelaySeconds).toBe(60); // 600 / 10
  });

  it("GET /lines/:id/history returns seasonality + annual from NJT official data", async () => {
    const { body } = await getJson<HistoryResponse>("/lines/NE/history");
    expect(body.scopeLabel).toBe("Northeast Corridor Line");
    expect(body.seasonality.find((m) => m.month === 7)?.avgOtpPercent).toBe(88.5);
    expect(body.annual.find((y) => y.year === 2025)?.avgOtpPercent).toBe(88.5);
  });

  it("GET /lightrail/summary returns OTP, per-line MDBF, and a trend", async () => {
    const { body } = await getJson<LightRailSummaryResponse>("/lightrail/summary?from=2025-07-01&to=2025-07-31");
    expect(body.otpPercent).toBe(96.5);
    expect(body.lines.find((l) => l.lineName === "Hudson-Bergen Light Rail")?.avgMdbf).toBe(30000);
    expect(body.otpTrend).toEqual([{ month: "2025-07", otpPercent: 96.5 }]);
  });

  it("GET /system/history returns seasonality + annual from real official data", async () => {
    const { body } = await getJson<HistoryResponse>("/system/history");
    expect(body.seasonality.find((m) => m.month === 7)?.avgOtpPercent).toBe(88.5);
    expect(body.annual.find((y) => y.year === 2025)?.avgOtpPercent).toBe(88.5);
    expect(body.mdbfAnnual?.[0]).toEqual({ year: 2025, avgMdbf: 90000 });
  });

  it("GET /health reports official-data coverage", async () => {
    const { body } = await getJson<HealthResponse>("/health");
    const nec = body.officialCoverage.find((c) => c.lineName === "Northeast Corridor Line");
    expect(nec).toMatchObject({ monthsPresent: 1, monthsExpected: 1 });
  });

  it("GET /stations lists stations with their lines", async () => {
    const { body } = await getJson<StationListResponse>("/stations");
    expect(body.stations.find((s) => s.stopId === "NWK")?.lines).toEqual(["Northeast Corridor Line"]);
  });

  it("GET /stations/:id/summary computes delay amplification", async () => {
    const { body } = await getJson<StationSummaryResponse>(`/stations/NWK/summary?${RANGE}`);
    expect(body.byLineDirection[0]).toMatchObject({ direction: "inbound", avgArrivalDelaySeconds: 120 });
    expect(body.amplification).toMatchObject({ arrivedWithin5Min: 40, departedLate: 8, amplificationRatePercent: 20 });
    expect(body.hourOfDay.find((h) => h.bucket === 8)?.avgDelaySeconds).toBe(60);
  });

  it("GET /stations/:id/top-delayed-trips uses the bounded event query", async () => {
    const { body } = await getJson<WorstTripsResponse>(`/stations/NWK/top-delayed-trips?${RANGE}`);
    expect(body.trips[0]).toMatchObject({ tripId: "T1", avgTerminalDelaySeconds: 1200 });
  });

  it("GET /connections reports success rate and a plain-English summary", async () => {
    const { body } = await getJson<ConnectionResponse>(
      `/connections?inbound_trip_id=T1&transfer_stop_id=NWK&outbound_trip_id=T2&${RANGE}`,
    );
    expect(body.successRatePercent).toBe(90);
    expect(body.lowSample).toBe(false);
    expect(body.summaryText).toContain("90%");
    expect(body.byDayOfWeek.find((d) => d.dayOfWeek === 2)?.successRatePercent).toBe(90);
  });

  it("GET /connections requires the trip/stop params", async () => {
    expect((await app.request(`/connections?inbound_trip_id=T1&${RANGE}`)).status).toBe(400);
  });

  it("GET /connections reports the no-observations path for an unknown triple", async () => {
    const { body } = await getJson<ConnectionResponse>(
      `/connections?inbound_trip_id=X&transfer_stop_id=Y&outbound_trip_id=Z&${RANGE}`,
    );
    expect(body.observations).toBe(0);
    expect(body.successRatePercent).toBe(0);
    expect(body.summaryText).toContain("No observations yet");
  });

  it("GET /connections/top auto-populates the highest-frequency transfers", async () => {
    const { body } = await getJson<ConnectionTopResponse>("/connections/top");
    expect(body.transfers[0]).toMatchObject({ transferStopId: "NWK", transferStopName: "Newark Penn", observations: 40 });
  });

  it("GET /alerts filters by line and lists the log", async () => {
    const { body } = await getJson<AlertListResponse>(`/alerts?line=NE&${RANGE}`);
    expect(body.total).toBe(1);
    expect(body.alerts[0]?.headerText).toBe("Delays on the NEC");
    const none = await getJson<AlertListResponse>(`/alerts?line=NC&${RANGE}`);
    expect(none.body.total).toBe(0);
  });

  it("GET /alerts/frequency counts by line and effect", async () => {
    const { body } = await getJson<AlertFrequencyResponse>(`/alerts/frequency?${RANGE}`);
    expect(body.byLine[0]).toMatchObject({ lineName: "Northeast Corridor Line", total: 1 });
    expect(body.byLine[0]?.counts.delay).toBe(1);
  });

  it("GET /export returns CSV for system and line", async () => {
    const system = await app.request(`/export?entity=system&${RANGE}`);
    expect(system.headers.get("Content-Type")).toContain("text/csv");
    expect(await system.text()).toContain("Trips operated");

    const line = await app.request(`/export?entity=line&id=NE&${RANGE}`);
    expect(line.status).toBe(200);
    expect(await line.text()).toContain("Northeast Corridor Line");

    expect((await app.request(`/export?entity=bogus&${RANGE}`)).status).toBe(400);
  });

  it("GET /export?entity=station returns CSV and requires an id", async () => {
    const station = await app.request(`/export?entity=station&id=NWK&${RANGE}`);
    expect(station.status).toBe(200);
    expect(station.headers.get("Content-Type")).toContain("text/csv");
    expect(await station.text()).toContain("Newark Penn");

    expect((await app.request(`/export?entity=station&${RANGE}`)).status).toBe(400);
  });

  it("GET /map returns an empty payload before any GTFS version is ingested", async () => {
    const empty = createApp(createRepositories(openDatabase()));
    const res = await empty.request("/map?from=2025-07-01&to=2025-07-31");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MapResponse;
    expect(body.stations).toEqual([]);
    expect(body.lines).toEqual([]);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await app.request("/nope")).status).toBe(404);
  });
});
