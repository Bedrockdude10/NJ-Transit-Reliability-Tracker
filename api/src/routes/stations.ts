import type { Repositories } from "@njt/db";
import {
  departureStatus,
  minutesUntil,
  type Departure,
  type Direction,
  type StationDeparturesResponse,
  type StationRankingSort,
  type StationRankingsResponse,
  type StationListResponse,
  type StationSummaryResponse,
  type WorstTrip,
  type WorstTripsResponse,
} from "@njt/shared";

import { Hono } from "hono";
import { buildDistributionResult, buildHeatmap, mergeCountMaps } from "../aggregation";
import { listStations, stopName } from "../catalog";
import { buildStationRankings } from "../station-rankings";
import { resolveRange } from "../dates";
import { CACHE_CONTROL_DAILY, parseBoundedInt, parseLimit, round1 } from "../util";

/** Roughly a commuter's planning window. */
const DEFAULT_HORIZON_MINUTES = 90;
/** Keep a just-departed train visible briefly so it doesn't vanish mid-glance. */
const DEPARTED_GRACE_SECONDS = 120;

export function stationRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const response: StationListResponse = { stations: listStations(repos) };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  /** Must stay declared before `/:stopId/…`, or "rankings" reads as a stop id. */
  router.get("/rankings", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const sort: StationRankingSort = c.req.query("sort") === "amplification" ? "amplification" : "delay";
    const limit = parseLimit(c.req.query("limit"), 20);

    const naming = new Map(
      listStations(repos).map((s) => [s.stopId, { stopName: s.stopName, lines: s.lines }] as const),
    );
    const { stations, excludedLowSample } = buildStationRankings(
      repos.aggregates.stationRankings(range.from, range.to),
      naming,
      sort,
      limit,
    );

    const response: StationRankingsResponse = {
      from: range.from,
      to: range.to,
      sort,
      stations,
      excludedLowSample,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  /**
   * Each poll rewrites a trip's stop rows, so stops a train has yet to reach
   * already hold the feed's current estimate. Not cacheable.
   */
  router.get("/:stopId/departures", (c) => {
    const stopId = c.req.param("stopId");
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const horizonMinutes = parseBoundedInt(c.req.query("horizonMinutes"), DEFAULT_HORIZON_MINUTES, 5, 720);
    const limit = parseLimit(c.req.query("limit"), 12);

    const version = repos.gtfs.currentVersion()?.versionId ?? null;
    const rows = repos.events.upcomingAtStop(
      stopId,
      version,
      nowSeconds - DEPARTED_GRACE_SECONDS,
      nowSeconds + horizonMinutes * 60,
      limit,
    );

    const departures: Departure[] = rows.map((r) => {
      const scheduledTime = r.scheduledDeparture ?? r.scheduledArrival;
      const predictedTime = r.tripCancelled ? null : r.predictedArrival;
      return {
        tripId: r.tripId,
        lineId: r.routeId,
        lineName: r.lineName,
        direction: r.direction,
        destination: r.headsign,
        scheduledTime,
        predictedTime,
        delaySeconds: r.tripCancelled ? null : r.delaySeconds,
        minutesAway: minutesUntil(predictedTime ?? scheduledTime, now),
        status: departureStatus({
          delaySeconds: r.delaySeconds,
          tripCancelled: r.tripCancelled,
          stopSkipped: r.stopSkipped,
        }),
      };
    });

    const response: StationDeparturesResponse = {
      stopId,
      stopName: stopName(repos, stopId),
      departures,
      horizonMinutes,
      generatedAtMs: now,
    };
    c.header("Cache-Control", "no-store");
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
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  // Scans events, but bounded by the (stop_id, service_date) index.
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
      serviceDate: string;
      scheduledDepartureSeconds: number | null;
    }
    const byTrip = new Map<string, Acc>();
    for (const e of repos.events.getByStop(stopId, range.from, range.to)) {
      if (e.delaySeconds === null || e.tripCancelled || e.stopSkipped) continue;
      const acc = byTrip.get(e.tripId) ?? { routeId: e.routeId, lineName: e.lineName, direction: e.direction, sum: 0, count: 0, serviceDate: "", scheduledDepartureSeconds: null };
      acc.sum += e.delaySeconds;
      acc.count += 1;
      // The newest run's timetable time, so a retimed train reads as it runs now.
      if (e.serviceDate >= acc.serviceDate) {
        acc.serviceDate = e.serviceDate;
        acc.scheduledDepartureSeconds = e.scheduledDeparture ?? e.scheduledArrival;
      }
      byTrip.set(e.tripId, acc);
    }

    const stationName = stopName(repos, stopId);
    const ranked = [...byTrip.entries()]
      .map(([tripId, a]) => ({ tripId, a, avg: round1(a.sum / a.count) }))
      .sort((x, y) => y.avg - x.avg)
      .slice(0, limit);
    // Where the train ends up, which is how a rider tells two departures apart.
    // Only the ranked few, so the per-trip lookup stays bounded.
    const trips: WorstTrip[] = ranked.map(({ tripId, a, avg }) => ({
      tripId,
      routeId: a.routeId,
      lineName: a.lineName,
      direction: a.direction,
      terminalStopName: repos.events.tripIdentity(tripId)?.terminalStopName ?? stationName,
      scheduledDepartureSeconds: a.scheduledDepartureSeconds,
      avgTerminalDelaySeconds: avg,
      observations: a.count,
    }));

    const response: WorstTripsResponse = { scopeLabel: stationName, from: range.from, to: range.to, trips };
    return c.json(response);
  });

  return router;
}
