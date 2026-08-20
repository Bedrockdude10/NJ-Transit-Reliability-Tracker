import type { Repositories, TrainRun } from "@njt/db";
import {
  LOW_SAMPLE_THRESHOLD,
  OTP_STRICT_THRESHOLD_SECONDS,
  OTP_THRESHOLDS_SECONDS,
  isOnTime,
  type TrainRecordResponse,
  type TrainRunResult,
} from "@njt/shared";
import { Hono } from "hono";
import { percentileOf } from "../aggregation";
import { stopName } from "../catalog";
import { resolveRange } from "../dates";
import { CACHE_CONTROL_DAILY, notFound, parsePositiveInt, round1 } from "../util";

/** How many runs the strip shows by default, after Zugfinder's recent-runs row. */
const DEFAULT_RECENT_RUNS = 20;

function toRun(run: TrainRun): TrainRunResult {
  return {
    serviceDate: run.serviceDate,
    delaySeconds: run.cancelled ? null : run.delaySeconds,
    cancelled: run.cancelled,
  };
}

export function trainRecordRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/:tripId/record", (c) => {
    const tripId = c.req.param("tripId");
    const identity = repos.events.tripIdentity(tripId);
    if (identity === null) notFound(`no trip ${tripId} in the archive`);

    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    // The terminal by default: it is where a whole journey's lateness lands.
    const stopId = c.req.query("stop_id") ?? identity.terminalStopId;
    const measuredAtStopName =
      stopId === identity.terminalStopId ? identity.terminalStopName : stopName(repos, stopId);

    const runs = repos.events.runsAtStop(tripId, stopId, range.from, range.to);
    const completed = runs.filter((r) => !r.cancelled && r.delaySeconds !== null);
    const delays = completed.map((r) => r.delaySeconds as number);
    const cancellations = runs.filter((r) => r.cancelled).length;
    const late = delays.filter((d) => d > OTP_STRICT_THRESHOLD_SECONDS).length;
    const limit = parsePositiveInt(c.req.query("recent"), DEFAULT_RECENT_RUNS);

    const response: TrainRecordResponse = {
      tripId,
      lineName: identity.lineName,
      direction: identity.direction,
      originStopName: identity.originStopName,
      terminalStopName: identity.terminalStopName,
      measuredAtStopId: stopId,
      measuredAtStopName,
      from: range.from,
      to: range.to,
      runs: runs.length,
      cancellations,
      latePercent: delays.length === 0 ? 0 : round1((late / delays.length) * 100),
      onTime: OTP_THRESHOLDS_SECONDS.map((thresholdSeconds) => ({
        thresholdSeconds,
        onTimePercent:
          delays.length === 0
            ? 0
            : round1((delays.filter((d) => isOnTime(d, thresholdSeconds)).length / delays.length) * 100),
      })),
      medianDelaySeconds: percentileOf(delays, 50),
      p90DelaySeconds: percentileOf(delays, 90),
      recentRuns: runs.slice(-limit).map(toRun),
      lowSample: delays.length < LOW_SAMPLE_THRESHOLD,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
