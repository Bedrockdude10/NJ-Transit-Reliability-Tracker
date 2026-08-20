import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { certificateResponseSchema, type CertificateBandResult, type TripStopEvent } from "@njt/shared";
import { localPartsToEpochSeconds } from "@njt/shared/zoned";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * `GET /certificates` — the delay certificate, after JR East's 遅延証明書. See
 * README "Delay certificate".
 */

const NEC = "Northeast Corridor Line";
const DATE = "2026-08-18";

/** An instant at a local wall-clock hour, which is what banding reads. */
function atLocalHour(hour: number, date = DATE): number {
  const [year, month, day] = date.split("-").map(Number);
  return localPartsToEpochSeconds({
    year: year ?? 2026,
    month: month ?? 8,
    day: day ?? 18,
    hour,
    minute: 30,
    second: 0,
  });
}

let repos: Repositories;
let app: ReturnType<typeof createApp>;
let sequence = 0;

beforeEach(() => {
  repos = createRepositories(openDatabase());
  app = createApp(repos, silentLogger);
  sequence = 0;
});

/** One arrival on `line`, at a local hour, that many seconds late. */
function arrival(hour: number, delaySeconds: number, opts: { line?: string; date?: string } = {}): TripStopEvent {
  sequence += 1;
  const observed = atLocalHour(hour, opts.date ?? DATE);
  return {
    tripId: `T${sequence}`,
    routeId: "NE",
    lineName: opts.line ?? NEC,
    stopId: "NYP",
    stopName: "New York Penn",
    stopSequence: 9,
    direction: "inbound",
    serviceDate: opts.date ?? DATE,
    scheduledArrival: observed - delaySeconds,
    scheduledDeparture: null,
    observedArrival: observed,
    delaySeconds,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: observed * 1000,
  };
}

const certificate = async (query = `?line=${encodeURIComponent(NEC)}&date=${DATE}`) => {
  const res = await app.request(`/certificates${query}`);
  return { status: res.status, body: await res.json() };
};

const band = (body: { bands: CertificateBandResult[] }, key: string) =>
  body.bands.find((b) => b.band === key);

describe("the delay certificate for one line on one date", () => {
  it("returns the shape the app validates", async () => {
    repos.events.recordMany([arrival(8, 600)]);
    const { body } = await certificate();
    expect(certificateResponseSchema.safeParse(body).success).toBe(true);
  });

  it("issues for a morning peak that ran five minutes late or worse", async () => {
    repos.events.recordMany([arrival(7, 600), arrival(8, 660), arrival(9, 540)]);
    const { body } = await certificate();
    expect(band(body, "am_peak")?.issued).toBe(true);
    expect(body.issued).toBe(true);
    expect(body.worstBand).toBe("am_peak");
  });

  it("does not issue for a peak that ran under the threshold", async () => {
    repos.events.recordMany([arrival(7, 120), arrival(8, 180)]);
    const { body } = await certificate();
    expect(band(body, "am_peak")?.issued).toBe(false);
    expect(body.issued).toBe(false);
    expect(body.worstBand).toBeNull();
  });

  it("reports every band of the day even when only one qualifies", async () => {
    repos.events.recordMany([arrival(8, 900), arrival(13, 30)]);
    const { body } = await certificate();
    expect(body.bands).toHaveLength(5);
    expect(band(body, "am_peak")?.issued).toBe(true);
    expect(band(body, "midday")?.issued).toBe(false);
  });

  it("does not issue for a band with no trains, which proves nothing either way", async () => {
    repos.events.recordMany([arrival(8, 900)]);
    const { body } = await certificate();
    const evening = band(body, "evening");
    expect(evening?.trainsObserved).toBe(0);
    expect(evening?.issued).toBe(false);
    expect(evening?.avgDelaySeconds).toBe(0);
  });

  it("names the worst band when more than one qualifies", async () => {
    repos.events.recordMany([arrival(8, 400), arrival(17, 1200)]);
    const { body } = await certificate();
    expect(body.worstBand).toBe("pm_peak");
  });

  it("bands by local wall clock, so a 17:00 arrival is the evening peak not midday", async () => {
    repos.events.recordMany([arrival(17, 600)]);
    const { body } = await certificate();
    expect(band(body, "pm_peak")?.trainsObserved).toBe(1);
    expect(band(body, "midday")?.trainsObserved).toBe(0);
  });

  it("bands correctly in January too, when the UTC offset differs by an hour", async () => {
    // A fixed offset would push an 08:30 EST arrival into a different band.
    repos.events.recordMany([arrival(8, 600, { date: "2026-01-14" })]);
    const { body } = await certificate(`?line=${encodeURIComponent(NEC)}&date=2026-01-14`);
    expect(band(body, "am_peak")?.trainsObserved).toBe(1);
  });

  it("counts how many trains were late, beside the average", async () => {
    repos.events.recordMany([arrival(8, 60), arrival(8, 900), arrival(8, 1200)]);
    const { body } = await certificate();
    const am = band(body, "am_peak");
    expect(am?.trainsObserved).toBe(3);
    expect(am?.trainsLate).toBe(2);
    expect(am?.maxDelaySeconds).toBe(1200);
  });

  it("keeps another line out of this line's certificate", async () => {
    repos.events.recordMany([arrival(8, 1200, { line: "Morris & Essex Line" }), arrival(8, 60)]);
    const { body } = await certificate();
    expect(band(body, "am_peak")?.trainsObserved).toBe(1);
    expect(body.issued).toBe(false);
  });

  it("says the sample is thin rather than certifying one train's bad morning", async () => {
    repos.events.recordMany([arrival(8, 900)]);
    const { body } = await certificate();
    expect(band(body, "am_peak")?.lowSample).toBe(true);
  });

  it("offers the dates and lines it holds, so a screen can choose", async () => {
    repos.events.recordMany([arrival(8, 60), arrival(8, 60, { line: "Morris & Essex Line" })]);
    const { body } = await certificate();
    expect(body.availableDates).toEqual([DATE]);
    expect(body.lines).toEqual(["Morris & Essex Line", NEC]);
  });

  it("defaults to the newest date it holds when none was asked for", async () => {
    repos.events.recordMany([arrival(8, 60, { date: "2026-08-17" }), arrival(8, 60, { date: DATE })]);
    const { body } = await certificate("");
    expect(body.serviceDate).toBe(DATE);
  });

  it("does not default to a service date that has not happened yet", async () => {
    // Trips running past midnight open tomorrow's partition, so the newest date
    // in the archive is routinely in the future and holds a handful of trains.
    repos.events.recordMany([
      arrival(8, 600, { date: "2026-08-19" }),
      arrival(1, 60, { date: "2026-08-20" }),
    ]);
    const { body } = await certificate("");
    expect(body.serviceDate).toBe("2026-08-19");
  });

  it("still serves a future date when one is asked for outright", async () => {
    repos.events.recordMany([arrival(1, 60, { date: "2026-08-20" })]);
    const { body } = await certificate(`?line=${encodeURIComponent(NEC)}&date=2026-08-20`);
    expect(body.serviceDate).toBe("2026-08-20");
  });

  it("answers an empty archive without inventing a line", async () => {
    const { status, body } = await certificate("");
    expect(status).toBe(200);
    expect(body.lineName).toBe("");
    expect(body.issued).toBe(false);
    expect(certificateResponseSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a malformed date rather than guessing", async () => {
    const res = await app.request("/certificates?date=August");
    expect(res.status).toBe(400);
  });

  it("states the threshold it applied, so the certificate is auditable", async () => {
    repos.events.recordMany([arrival(8, 900)]);
    const { body } = await certificate();
    expect(body.thresholdSeconds).toBe(300);
  });
});
