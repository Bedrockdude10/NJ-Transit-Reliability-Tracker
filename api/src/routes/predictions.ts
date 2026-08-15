import type { Repositories } from "@njt/db";
import type {
  DelayPrediction,
  PredictedDelay,
  PredictionsResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { CACHE_CONTROL_DAILY } from "../util";

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

    const stored = repos.predictions.forServiceDate(serviceDate);
    const version = repos.gtfs.currentVersion();
    const stopName = (stopId: string) =>
      (version && repos.gtfs.stopName(version.versionId, stopId)) ?? stopId;

    const predictions: PredictedDelay[] = stored.map((prediction) => ({
      tripId: prediction.tripId,
      lineName: prediction.lineName,
      fromStopName: stopName(prediction.fromStopId),
      toStopName: stopName(prediction.toStopId),
      horizonSeconds: prediction.horizonSeconds,
      predictedDelaySeconds: prediction.predictedDelaySeconds,
      actualDelaySeconds: prediction.actualDelaySeconds,
      errorSeconds: errorSeconds(prediction),
    }));

    // Only legs whose actual is known. Predictions are written before a trip
    // runs, so most of a day has none — counting those as zero error would
    // flatter the model by exactly the share of the day still ahead.
    const scored = predictions.filter((p) => p.errorSeconds !== null);
    const meanAbsoluteErrorSeconds = scored.length
      ? scored.reduce((total, p) => total + Math.abs(p.errorSeconds!), 0) / scored.length
      : null;

    const response: PredictionsResponse = {
      serviceDate,
      available: stored.length > 0,
      availableDates,
      provenance: repos.predictions.latestRun(),
      predictions,
      meanAbsoluteErrorSeconds,
      scoredCount: scored.length,
    };

    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
