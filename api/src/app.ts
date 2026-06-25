import type { Repositories } from "@njt/db";
import { DISCLAIMER_TEXT } from "@njt/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { alertRoutes } from "./routes/alerts";
import { connectionRoutes } from "./routes/connections";
import { exportRoutes } from "./routes/export";
import { healthRoutes } from "./routes/health";
import { lineRoutes } from "./routes/lines";
import { stationRoutes } from "./routes/stations";
import { systemRoutes } from "./routes/system";
import { ApiError } from "./util";

/**
 * Build the read-only API over a set of repositories. Pure and dependency-
 * injected so tests can drive it with `app.request(...)` against an in-memory
 * database — no network or server needed.
 */
export function createApp(repos: Repositories): Hono {
  const app = new Hono();

  app.use("*", cors());
  // Compliance: surface the disclaimer on every response.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-NJT-Disclaimer", DISCLAIMER_TEXT);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
    console.error("Unhandled API error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.get("/", (c) => c.json({ name: "NJ Transit Reliability API", disclaimer: DISCLAIMER_TEXT }));

  app.route("/health", healthRoutes(repos));
  app.route("/system", systemRoutes(repos));
  app.route("/lines", lineRoutes(repos));
  app.route("/stations", stationRoutes(repos));
  app.route("/connections", connectionRoutes(repos));
  app.route("/alerts", alertRoutes(repos));
  app.route("/export", exportRoutes(repos));

  return app;
}
