import type { Repositories } from "@njt/db";
import type {
  Direction,
  StationListResponse,
  StationSummaryResponse,
  WorstTrip,
  WorstTripsResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { buildDistributionResult, buildHeatmap, mergeCountMaps } from "../aggregation";
import { listStations, stopName } from "../catalog";
import { resolveRange } from "../dates";
import { parseLimit, round1 } from "../util";

export function stationRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const response: StationListResponse = { stations: listStations(repos) };
    return c.json(response);
  });

  router.get("/:stopId/summary", (c) => {
    const stopId = c.req.param("stopId");
    const range = resolveRange(c.req.query("from"), c.req.query("to"));

    const byLineDirection = repos.aggregates.stationByLineDirection(stopId, range.from, range.to).map((r) => ({
      lineName: r.lineName,
      direction: r.direction,
      avgArrivalDelaySeconds: r.observations > 0 ? round1(r.sumArrivalDelaySeconds / r.observations) : 0,
      observations: r.observations,
    }));

    const distCounts = mergeCountMaps(
      repos.aggregates.getStationDistributionRows(stopId, range.from, range.to).map((r) => r.counts),
    );

    const hourly = repos.aggregates
      .stationHourly(stopId, range.from, range.to)
      .map((h) => ({ bucket: h.hour, sumDelaySeconds: h.sumDelaySeconds, observations: h.observations }));

    const amp = repos.aggregates.stationAmplification(stopId, range.from, range.to);

    const response: StationSummaryResponse = {
      stopId,
      stopName: stopName(repos, stopId),
      from: range.from,
      to: range.to,
      byLineDirection,
      delayDistribution: buildDistributionResult(distCounts),
      hourOfDay: buildHeatmap(hourly, "hour_of_day"),
      amplification: {
        arrivedWithin5Min: amp.arrivedWithin5Min,
        departedLate: amp.departedLateAfterOnTimeArrival,
        amplificationRatePercent:
          amp.arrivedWithin5Min > 0 ? round1((amp.departedLateAfterOnTimeArrival / amp.arrivedWithin5Min) * 100) : 0,
      },
    };
    return c.json(response);
  });

  // Worst trips *through* a station. This is a bounded single-station query on
  // the event table (indexed by stop_id, service_date) — not a system-wide scan.
  router.get("/:stopId/top-delayed-trips", (c) => {
    const stopId = c.req.param("stopId");
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const limit = parseLimit(c.req.query("limit"), 10);

    interface Acc {
      routeId: string;
      lineName: string;
      direction: Direction;
      sum: number;
      count: number;
    }
    const byTrip = new Map<string, Acc>();
    for (const e of repos.events.getByStop(stopId, range.from, range.to)) {
      if (e.delaySeconds === null || e.tripCancelled || e.stopSkipped) continue;
      const acc = byTrip.get(e.tripId) ?? { routeId: e.routeId, lineName: e.lineName, direction: e.direction, sum: 0, count: 0 };
      acc.sum += e.delaySeconds;
      acc.count += 1;
      byTrip.set(e.tripId, acc);
    }

    const stationName = stopName(repos, stopId);
    const trips: WorstTrip[] = [...byTrip.entries()]
      .map(([tripId, a]) => ({
        tripId,
        routeId: a.routeId,
        lineName: a.lineName,
        direction: a.direction,
        terminalStopName: stationName,
        avgTerminalDelaySeconds: round1(a.sum / a.count),
        observations: a.count,
      }))
      .sort((x, y) => y.avgTerminalDelaySeconds - x.avgTerminalDelaySeconds)
      .slice(0, limit);

    const response: WorstTripsResponse = { scopeLabel: stationName, from: range.from, to: range.to, trips };
    return c.json(response);
  });

  return router;
}
