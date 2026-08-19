import type { Repositories } from "@njt/db";
import type {
  DelayPrediction,
  PredictedDelay,
  PredictionsResponse,
} from "@njt/shared";
import { predictionInterval } from "@njt/shared";
import { Hono } from "hono";
import { CACHE_CONTROL_MINUTE } from "../util";

const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Sorts after every real "HH:MM:SS", so a leg with no timetable entry lands last. */
const NO_TIMETABLE = "99:99:99";

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
    const requestedLimit = c.req.query("limit");
    const limit = requestedLimit === undefined ? null : Number(requestedLimit);
    if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
      return c.json({ error: "limit must be a positive number" }, 400);
    }

    const all = repos.predictions.forServiceDate(serviceDate);
    const stored = line ? all.filter((p) => p.lineName === line) : all;
    const version = repos.gtfs.currentVersion();
    const stopName = (stopId: string) =>
      (version && repos.gtfs.stopName(version.versionId, stopId)) ?? stopId;

    const arrivals = version
      ? repos.gtfs.arrivalTimesForTrips(version.versionId, stored.map((p) => p.tripId))
      : new Map<string, string>();
    const arrivalTime = (p: DelayPrediction) => arrivals.get(`${p.tripId}|${p.toStopId}`) ?? null;

    const chronological = [...stored].sort((a, b) =>
      (arrivalTime(a) ?? NO_TIMETABLE).localeCompare(arrivalTime(b) ?? NO_TIMETABLE),
    );
    const selected = limit === null ? chronological : chronological.slice(0, limit);
    const predictions: PredictedDelay[] = selected.map((prediction) => ({
      tripId: prediction.tripId,
      lineName: prediction.lineName,
      fromStopName: stopName(prediction.fromStopId),
      toStopName: stopName(prediction.toStopId),
      horizonSeconds: prediction.horizonSeconds,
      scheduledArrivalTime: arrivalTime(prediction),
      predictedDelaySeconds: prediction.predictedDelaySeconds,
      interval: predictionInterval(prediction),
      actualDelaySeconds: prediction.actualDelaySeconds,
      errorSeconds: errorSeconds(prediction),
    }));

    // Score the whole day, not `predictions`, which a `limit` can truncate.
    const scored = stored.filter(
      (p): p is typeof p & { actualDelaySeconds: number } => p.actualDelaySeconds !== null,
    );
    const meanAbsoluteErrorSeconds = scored.length
      ? scored.reduce((total, p) => total + Math.abs(p.actualDelaySeconds - p.predictedDelaySeconds), 0) /
        scored.length
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
