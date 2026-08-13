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

/** How far ahead the board looks by default — roughly a commuter's planning window. */
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

  /**
   * GET /stations/rankings — which stations are worst, and in which sense.
   *
   * Declared before `/:stopId/...` so "rankings" is never read as a stop id.
   */
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
   * GET /stations/:stopId/departures — the live board.
   *
   * Reads forward predictions the pipeline already stores: each poll rewrites a
   * trip's stop rows, so stops a train has yet to reach hold the feed's current
   * estimate. Not cacheable — it changes every poll and every second.
   */
  router.get("/:stopId/departures", (c) => {
    const stopId = c.req.param("stopId");
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const horizonMinutes = parseBoundedInt(c.req.query("horizonMinutes"), DEFAULT_HORIZON_MINUTES, 5, 720);
    const limit = parseLimit(c.req.query("limit"), 12);

    const version = repos.gtfs.currentVersion()?.versionId ?? null;
    // Look slightly back as well, so a train due a moment ago still shows as
    // "departed" rather than silently disappearing while a rider is looking.
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
