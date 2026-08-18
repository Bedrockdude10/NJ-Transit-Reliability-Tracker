import type { Repositories } from "@njt/db";
import { OTP_STRICT_THRESHOLD_SECONDS, type CommuteResponse } from "@njt/shared";
import { Hono } from "hono";
import { buildCommuteDepartures, medianOf, percentileOf, rankDepartures } from "../commute";
import { stopName } from "../catalog";
import { resolveRange } from "../dates";
import { CACHE_CONTROL_DAILY, badRequest, round1 } from "../util";

export function commuteRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const origin = c.req.query("origin");
    const destination = c.req.query("destination");
    if (!origin || !destination) badRequest("origin and destination stop ids are required");
    if (origin === destination) badRequest("origin and destination must differ");

    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const journeys = repos.events.journeysBetween(origin!, destination!, range.from, range.to);

    const completed = journeys.filter((j) => !j.cancelled && !j.skipped && j.destinationDelaySeconds !== null);
    const delays = completed.map((j) => j.destinationDelaySeconds as number);
    const cancellations = journeys.filter((j) => j.cancelled).length;

    const journeyMinutes = completed
      .filter((j) => j.observedArrival !== null && j.scheduledDeparture !== null)
      .map((j) => Math.round(((j.observedArrival as number) - (j.scheduledDeparture as number)) / 60));
    const scheduledMinutes = completed
      .filter((j) => j.scheduledArrival !== null && j.scheduledDeparture !== null)
      .map((j) => Math.round(((j.scheduledArrival as number) - (j.scheduledDeparture as number)) / 60));

    const departures = buildCommuteDepartures(journeys);
    const { mostReliable, leastReliable } = rankDepartures(departures);

    const onTimePercent =
      delays.length > 0 ? round1((delays.filter((d) => d <= OTP_STRICT_THRESHOLD_SECONDS).length / delays.length) * 100) : null;

    const originName = stopName(repos, origin!);
    const destinationName = stopName(repos, destination!);

    const response: CommuteResponse = {
      origin: { stopId: origin!, stopName: originName },
      destination: { stopId: destination!, stopName: destinationName },
      from: range.from,
      to: range.to,
      linesServing: [...new Set(journeys.map((j) => j.lineName))].sort(),
      observations: journeys.length,
      cancellations,
      cancellationRatePercent: journeys.length > 0 ? round1((cancellations / journeys.length) * 100) : 0,
      onTimePercent,
      avgArrivalDelaySeconds: delays.length > 0 ? round1(delays.reduce((s, d) => s + d, 0) / delays.length) : null,
      p90ArrivalDelaySeconds: percentileOf(delays, 90),
      medianJourneyMinutes: medianOf(journeyMinutes),
      scheduledJourneyMinutes: medianOf(scheduledMinutes),
      departures,
      mostReliable,
      leastReliable,
    };

    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
