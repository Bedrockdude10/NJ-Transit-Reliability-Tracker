import type { Repositories } from "@njt/db";
import { DISCLAIMER_TEXT } from "@njt/shared";
import { consoleLogger, type Logger } from "@njt/shared/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { alertRoutes } from "./routes/alerts";
import { commuteRoutes } from "./routes/commute";
import { connectionRoutes } from "./routes/connections";
import { exportRoutes } from "./routes/export";
import { certificateRoutes } from "./routes/certificates";
import { predictionRoutes } from "./routes/predictions";
import { trainRecordRoutes } from "./routes/train-record";
import { healthRoutes } from "./routes/health";
import { lightRailRoutes } from "./routes/lightrail";
import { lineRoutes } from "./routes/lines";
import { mapRoutes } from "./routes/map";
import { modelRoutes } from "./routes/models";
import { stationRoutes } from "./routes/stations";
import { systemRoutes } from "./routes/system";
import { ApiError } from "./util";

export function createApp(repos: Repositories, log: Logger = consoleLogger): Hono {
  const app = new Hono();

  app.use("*", cors());

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
  // Compliance: the disclaimer must ride on every response.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-NJT-Disclaimer", DISCLAIMER_TEXT);
  });

  app.onError((err, c) => {
    // A deliberate 4xx is an answer, not an incident.
    if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
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
  app.route("/models", modelRoutes(repos));
  app.route("/lightrail", lightRailRoutes(repos));
  app.route("/map", mapRoutes(repos));
  app.route("/stations", stationRoutes(repos));
  app.route("/commute", commuteRoutes(repos));
  app.route("/connections", connectionRoutes(repos));
  app.route("/alerts", alertRoutes(repos));
  app.route("/predictions", predictionRoutes(repos));
  app.route("/trips", trainRecordRoutes(repos));
  app.route("/certificates", certificateRoutes(repos));
  app.route("/export", exportRoutes(repos));

  return app;
}
