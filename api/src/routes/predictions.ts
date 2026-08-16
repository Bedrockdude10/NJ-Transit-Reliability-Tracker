import type { Repositories } from "@njt/db";
import type {
  DelayPrediction,
  PredictedDelay,
  PredictionsResponse,
} from "@njt/shared";
import { predictionInterval } from "@njt/shared";
import { Hono } from "hono";
import { CACHE_CONTROL_MINUTE } from "../util";

/**
 * `GET /predictions?date=` — model output for one service date.
 *
 * Read from SQLite like everything else. The predictions were produced by
 * `njt-delay-modeling`, written to object storage, and imported by the pipeline;
 * serving them from a local table keeps a bucket outage out of the request path.
 *
 * The endpoint's most important job is the empty answer. No model has run yet,
 * and this project publishes no synthetic data, so an unpredicted day says so
 * explicitly — `available: false` with the dates that *do* hold predictions — and
 * a screen can render that calmly instead of treating it as a failure.
 */
const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How many legs a response carries.
 *
 * A day holds ~50,000, nearly all of them small and most of them repetitive —
 * the Princeton shuttle predicted on time, forty times over. Returning them all
 * is ~5 MB of JSON for a phone to parse in order to show a table nobody reads
 * past the top of. The interesting ones are the trains in trouble.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** Signed error, positive when the model was optimistic — it under-predicted. */
function errorSeconds(prediction: DelayPrediction): number | null {
  if (prediction.actualDelaySeconds === null) return null;
  return prediction.actualDelaySeconds - prediction.predictedDelaySeconds;
}

export function predictionRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const requested = c.req.query("date");
    if (requested !== undefined && !SERVICE_DATE.test(requested)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }

    const availableDates = repos.predictions.serviceDates();
    // With no date asked for, the newest predicted day is the useful default:
    // today is usually empty, since predictions are published per service date.
    const serviceDate = requested ?? availableDates.at(-1) ?? new Date().toISOString().slice(0, 10);

    const line = c.req.query("line");
    const requestedLimit = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      return c.json({ error: "limit must be a positive number" }, 400);
    }
    const limit = Math.min(requestedLimit, MAX_LIMIT);

    const all = repos.predictions.forServiceDate(serviceDate);
    const stored = line ? all.filter((p) => p.lineName === line) : all;
    const version = repos.gtfs.currentVersion();
    const stopName = (stopId: string) =>
      (version && repos.gtfs.stopName(version.versionId, stopId)) ?? stopId;

    // Largest predicted delay first, then truncate: the top of this list is the
    // reason anyone opened the page.
    const ranked = [...stored].sort(
      (a, b) => Math.abs(b.predictedDelaySeconds) - Math.abs(a.predictedDelaySeconds),
    );
    const predictions: PredictedDelay[] = ranked.slice(0, limit).map((prediction) => ({
      tripId: prediction.tripId,
      lineName: prediction.lineName,
      fromStopName: stopName(prediction.fromStopId),
      toStopName: stopName(prediction.toStopId),
      horizonSeconds: prediction.horizonSeconds,
      predictedDelaySeconds: prediction.predictedDelaySeconds,
      interval: predictionInterval(prediction),
      actualDelaySeconds: prediction.actualDelaySeconds,
      errorSeconds: errorSeconds(prediction),
    }));

    // Scored over the *whole* day, not the truncated list: the headline is how
    // the model did, and ranking by delay first would score it only on the
    // hardest cases it faces.
    const scored = stored.filter((p) => p.actualDelaySeconds !== null);
    const meanAbsoluteErrorSeconds = scored.length
      ? scored.reduce(
          (total, p) => total + Math.abs(p.actualDelaySeconds! - p.predictedDelaySeconds),
          0,
        ) / scored.length
      : null;

    const response: PredictionsResponse = {
      serviceDate,
      available: stored.length > 0,
      availableDates,
      lines: [...new Set(all.map((p) => p.lineName))].sort(),
      provenance: repos.predictions.latestRun(),
      predictions,
      totalPredictions: stored.length,
      meanAbsoluteErrorSeconds,
      scoredCount: scored.length,
    };

    c.header("Cache-Control", CACHE_CONTROL_MINUTE);
    return c.json(response);
  });

  return router;
}
