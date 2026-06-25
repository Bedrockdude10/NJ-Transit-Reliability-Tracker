import type { Repositories } from "@njt/db";
import type { HealthResponse } from "@njt/shared";
import { Hono } from "hono";
import { round1 } from "../util";

/** GET /health — pipeline operational status (publicly viewable). */
export function healthRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const response: HealthResponse = {
      collectionStartDate: repos.health.collectionStartDate(),
      uptimePercent: round1(repos.health.uptimePercent()),
      feeds: repos.health.feedHealth(),
      knownGaps: repos.health.gaps(),
      generatedAtMs: Date.now(),
    };
    return c.json(response);
  });

  return router;
}
