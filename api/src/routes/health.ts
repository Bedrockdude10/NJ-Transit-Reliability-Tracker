import type { Repositories } from "@njt/db";
import { NO_TRIP_UPDATES_ALERT_MS, type HealthResponse } from "@njt/shared";
import { Hono } from "hono";
import { buildOfficialCoverage } from "../aggregation";
import { ALL_MONTHS } from "../dates";
import { ingestLiveness } from "../liveness";
import { round1 } from "../util";

export function healthRoutes(repos: Repositories): Hono {
  const router = new Hono();

  /**
   * 200 while ingest is running, 503 once it has stalled — the endpoint external
   * monitors watch. Never cached: a cached liveness check checks the cache.
   */
  router.get("/live", (c) => {
    const liveness = ingestLiveness(
      repos.health.feedHealth(),
      Date.now(),
      Number(process.env.NJT_NO_TRIP_UPDATES_ALERT_MS ?? NO_TRIP_UPDATES_ALERT_MS),
    );
    c.header("Cache-Control", "no-store");
    return c.json(liveness, liveness.ok ? 200 : 503);
  });

  router.get("/", (c) => {
    // Pass into uptimePercent, which would otherwise look it up again.
    const collectionStartDate = repos.health.collectionStartDate();
    const response: HealthResponse = {
      collectionStartDate,
      uptimePercent: round1(repos.health.uptimePercent(Date.now(), collectionStartDate)),
      feeds: repos.health.feedHealth(),
      knownGaps: repos.health.gaps(),
      officialCoverage: buildOfficialCoverage(repos.official.getAllForRange(ALL_MONTHS.from, ALL_MONTHS.to)),
      generatedAtMs: Date.now(),
    };
    return c.json(response);
  });

  return router;
}
