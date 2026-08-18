import type { Repositories } from "@njt/db";
import type {
  DelayPrediction,
  PredictedDelay,
  PredictionsResponse,
} from "@njt/shared";
import { predictionInterval } from "@njt/shared";
import { Hono } from "hono";
import { CACHE_CONTROL_MINUTE } from "../util";

const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A day holds ~50,000 legs; returning them all is ~5 MB of JSON. */
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
    // Today is usually empty, so default to the newest predicted day.
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

    // Score the whole day, not `predictions`: that is ranked by delay, so it
    // would score the model only on its hardest cases.
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
