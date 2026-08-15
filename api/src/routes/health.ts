import type { Repositories } from "@njt/db";
import { NO_TRIP_UPDATES_ALERT_MS, type HealthResponse } from "@njt/shared";
import { Hono } from "hono";
import { buildOfficialCoverage } from "../aggregation";
import { ALL_MONTHS } from "../dates";
import { ingestLiveness } from "../liveness";
import { round1 } from "../util";

/** GET /health — pipeline operational status + official-data completeness. */
export function healthRoutes(repos: Repositories): Hono {
  const router = new Hono();

  /**
   * `GET /health/live` — 200 while ingest is running, 503 once it has stalled.
   *
   * The endpoint an external uptime monitor watches. `/health` is a report and
   * answers 200 whether or not the pipeline is alive; a monitor can only act on
   * a status code, so the judgement has to be made here rather than left to a
   * keyword match against a JSON body full of timestamps.
   *
   * Never cached. A cached liveness check is a check of the cache.
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
    // Resolve the collection start once and pass it into uptimePercent (which
    // would otherwise look it up again).
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
