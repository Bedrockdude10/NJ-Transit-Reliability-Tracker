import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { FeedHealth } from "@njt/shared";
import { silentLogger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ingestLiveness } from "../src/liveness";

/**
 * The check an uptime monitor can act on.
 *
 * `/health` is a report and answers 200 whenever the API is up — which, since
 * the supervisor keeps the API alive through a pipeline crash, is true of a site
 * that has silently stopped collecting anything. An ingest gap is permanent:
 * NJT serves no history, so a day noticed late is a day gone.
 */

const HOUR = 3_600_000;
const NOW = 1_786_500_000_000;

const feed = (overrides: Partial<FeedHealth> = {}): FeedHealth => ({
  feedType: "TripUpdates",
  lastSuccessAtMs: NOW - 30_000,
  lastFailureAtMs: null,
  pollsToday: 100,
  failuresToday: 0,
  ...overrides,
});

describe("ingestLiveness", () => {
  it("is healthy while the feed is being fetched", () => {
    expect(ingestLiveness([feed()], NOW, HOUR)).toMatchObject({ ok: true, staleForMs: 30_000 });
  });

  it("is healthy right up to the threshold", () => {
    expect(ingestLiveness([feed({ lastSuccessAtMs: NOW - HOUR })], NOW, HOUR).ok).toBe(true);
  });

  it("fails once the feed has been silent longer than the threshold", () => {
    const liveness = ingestLiveness([feed({ lastSuccessAtMs: NOW - HOUR - 1 })], NOW, HOUR);
    expect(liveness.ok).toBe(false);
    expect(liveness.reason).toMatch(/no TripUpdates fetch for 60 minutes/);
  });

  it("fails when nothing has ever been ingested", () => {
    // The worst version of this, and the one a "no news is good news" check
    // would call healthy: a machine that has never collected anything.
    const liveness = ingestLiveness([feed({ lastSuccessAtMs: null })], NOW, HOUR);
    expect(liveness.ok).toBe(false);
    expect(liveness.reason).toMatch(/has ever been recorded/);
  });

  it("fails when the feed is absent entirely", () => {
    expect(ingestLiveness([], NOW, HOUR).ok).toBe(false);
  });

  /**
   * The other feeds are collected but nothing is derived from them. Alerting on
   * a feed whose failure changes no number is how an alert stops being read.
   */
  it("ignores feeds that no measurement depends on", () => {
    const liveness = ingestLiveness(
      [feed({ feedType: "VehiclePositions", lastSuccessAtMs: NOW - 5 * HOUR }), feed()],
      NOW,
      HOUR,
    );
    expect(liveness.ok).toBe(true);
  });

  it("does not read a clock that went backwards as an outage", () => {
    expect(ingestLiveness([feed({ lastSuccessAtMs: NOW + 60_000 })], NOW, HOUR).ok).toBe(true);
  });
});

describe("GET /health/live", () => {
  let repos: Repositories;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repos = createRepositories(openDatabase());
    app = createApp(repos, silentLogger);
  });

  it("answers 503 with a reason when nothing has been ingested", async () => {
    // A monitor can only act on a status code, so the judgement has to be made
    // here rather than left to a keyword match on a body full of timestamps.
    const response = await app.request("/health/live");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, feedType: "TripUpdates" });
  });

  it("answers 200 once the feed is being fetched", async () => {
    repos.health.recordSuccess("TripUpdates", Date.now());
    const response = await app.request("/health/live");
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("is never cached, since a cached liveness check checks the cache", async () => {
    const response = await app.request("/health/live");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves /health itself answering 200, as the report it is", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });
});
