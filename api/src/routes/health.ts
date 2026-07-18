import type { Repositories } from "@njt/db";
import type { HealthResponse } from "@njt/shared";
import { Hono } from "hono";
import { buildOfficialCoverage } from "../aggregation";
import { ALL_MONTHS } from "../dates";
import { round1 } from "../util";

/** GET /health — pipeline operational status + official-data completeness. */
export function healthRoutes(repos: Repositories): Hono {
  const router = new Hono();

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
