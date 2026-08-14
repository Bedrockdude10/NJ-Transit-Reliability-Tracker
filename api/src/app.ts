import type { Repositories } from "@njt/db";
import { DISCLAIMER_TEXT } from "@njt/shared";
import { consoleLogger, type Logger } from "@njt/shared/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { alertRoutes } from "./routes/alerts";
import { commuteRoutes } from "./routes/commute";
import { connectionRoutes } from "./routes/connections";
import { exportRoutes } from "./routes/export";
import { healthRoutes } from "./routes/health";
import { lightRailRoutes } from "./routes/lightrail";
import { lineRoutes } from "./routes/lines";
import { mapRoutes } from "./routes/map";
import { stationRoutes } from "./routes/stations";
import { systemRoutes } from "./routes/system";
import { ApiError } from "./util";

/**
 * Build the read-only API over a set of repositories. Pure and dependency-
 * injected so tests can drive it with `app.request(...)` against an in-memory
 * database — no network or server needed.
 */
export function createApp(repos: Repositories, log: Logger = consoleLogger): Hono {
  const app = new Hono();

  app.use("*", cors());

  /**
   * Request log, as JSON so a log drain can filter on status or path.
   *
   * Hono ships a `logger()` middleware, but it emits a formatted line
   * ("--> GET /x 200 5ms") that would have to be parsed back into fields to be
   * useful. Emitting the fields directly is both shorter and greppable.
   */
  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });
  // Compliance: surface the disclaimer on every response.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-NJT-Disclaimer", DISCLAIMER_TEXT);
  });

  app.onError((err, c) => {
    // A deliberate 4xx is an answer, not an incident.
    if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
    // Previously `console.error("Unhandled API error:", err)`, which said
    // nothing about *which* endpoint failed — leaving a 500 in the logs with no
    // way to reproduce it.
    log.error("unhandled api error", {
      method: c.req.method,
      path: c.req.path,
      query: c.req.url.split("?")[1] ?? null,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "Internal server error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.get("/", (c) => c.json({ name: "NJ Transit Reliability API", disclaimer: DISCLAIMER_TEXT }));

  app.route("/health", healthRoutes(repos));
  app.route("/system", systemRoutes(repos));
  app.route("/lines", lineRoutes(repos));
  app.route("/lightrail", lightRailRoutes(repos));
  app.route("/map", mapRoutes(repos));
  app.route("/stations", stationRoutes(repos));
  app.route("/commute", commuteRoutes(repos));
  app.route("/connections", connectionRoutes(repos));
  app.route("/alerts", alertRoutes(repos));
  app.route("/export", exportRoutes(repos));

  return app;
}
