import type { Repositories } from "@njt/db";
import {
  NJT_OFFICIAL_THRESHOLD_SECONDS,
  monthKey,
  parseDateString,
  type HeatmapResponse,
  type HistoryResponse,
  type LineListResponse,
  type LineMonthlyResponse,
  type LineSummaryResponse,
  type LineTrendResponse,
  type MonthlyComparisonRow,
  type OfficialNjtMetric,
  type OtpDailyRow,
  type PropagationResponse,
  type TrendPoint,
  type WorstTripsResponse,
} from "@njt/shared";
import { Hono } from "hono";
import {
  ON_TIME_15_MIN,
  buildAnnualOtp,
  buildCancellations,
  buildHeatmap,
  buildOfficialComparison,
  buildOtpSummary,
  buildSeasonality,
} from "../aggregation";
import { listLines, requireLine } from "../catalog";
import { buildPropagation, netAccumulated, rankSegments, summarizePropagation } from "../propagation";
import { monthRange, resolveRange } from "../dates";
import { resolveOfficialWindow } from "../official-window";
import { CACHE_CONTROL_DAILY, parseHeatmapType, parseLimit, round1 } from "../util";

/** Monday (ISO week start) of a YYYY-MM-DD date, as YYYY-MM-DD. */
function weekStart(date: string): string {
  const { year, month, day } = parseDateString(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow; // back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function trendPoint(date: string, operated: number, cancelled: number, onTime15: number, njt: number | null): TrendPoint {
  const scheduled = operated + cancelled;
  return {
    date,
    otpPercent15Min: operated > 0 ? round1((onTime15 / operated) * 100) : 0,
    cancellationRatePercent: scheduled > 0 ? round1((cancelled / scheduled) * 100) : 0,
    tripsOperated: operated,
    njtOfficialOtpPercent: njt,
  };
}

function buildTrend(rows: readonly OtpDailyRow[], interval: "daily" | "weekly", officialByMonth: Map<string, number>): TrendPoint[] {
  const njtFor = (date: string): number | null => {
    const { year, month } = parseDateString(date);
    return officialByMonth.get(monthKey(year, month)) ?? null;
  };

  if (interval === "daily") {
    return rows.map((r) =>
      trendPoint(r.serviceDate, r.tripsOperated, r.tripsCancelled, r.onTimeCounts[ON_TIME_15_MIN] ?? 0, njtFor(r.serviceDate)),
    );
  }

  const byWeek = new Map<string, { operated: number; cancelled: number; onTime15: number }>();
  for (const r of rows) {
    const key = weekStart(r.serviceDate);
    const acc = byWeek.get(key) ?? { operated: 0, cancelled: 0, onTime15: 0 };
    acc.operated += r.tripsOperated;
    acc.cancelled += r.tripsCancelled;
    acc.onTime15 += r.onTimeCounts[ON_TIME_15_MIN] ?? 0;
    byWeek.set(key, acc);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => trendPoint(date, acc.operated, acc.cancelled, acc.onTime15, njtFor(date)));
}

export function lineRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const response: LineListResponse = { lines: listLines(repos) };
    return c.json(response);
  });

  router.get("/:lineId/summary", (c) => {
    const { routeId, name } = requireLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const dist = repos.aggregates.getDelayDistributionDailyRows("line", routeId, range.from, range.to);
    // One ranged query across all directions, grouped in memory (was three
    // getOtpDailyRows differing only by direction).
    const byDirection = new Map<string, OtpDailyRow[]>();
    for (const row of repos.aggregates.getOtpDailyRowsAllDirections("line", routeId, range.from, range.to)) {
      const list = byDirection.get(row.direction);
      if (list) list.push(row);
      else byDirection.set(row.direction, [row]);
    }
    const otpFor = (dir: "all" | "inbound" | "outbound") => byDirection.get(dir) ?? [];
    const months = monthRange(range);
    // NJT publishes monthly and in arrears; fall back to the newest published
    // month rather than blanking the comparison on a recent-dates request.
    const official = resolveOfficialWindow(
      months,
      (from, to) => repos.official.getForLineRange(name, from, to),
      () => repos.official.latestMonth(name),
    );
    const officialMetrics = official.metrics;

    const response: LineSummaryResponse = {
      lineId: routeId,
      name,
      from: range.from,
      to: range.to,
      overall: buildOtpSummary(otpFor("all"), dist),
      // Per-direction distribution isn't stored; direction summaries focus on OTP/counts.
      inbound: buildOtpSummary(otpFor("inbound"), []),
      outbound: buildOtpSummary(otpFor("outbound"), []),
      njtOfficial: buildOfficialComparison(officialMetrics),
      njtCancellations: buildCancellations(officialMetrics),
      officialCoverage: official.coverage,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  router.get("/:lineId/trend", (c) => {
    const { routeId, name } = requireLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const interval = c.req.query("interval") === "weekly" ? "weekly" : "daily";
    const rows = repos.aggregates.getOtpDailyRows("line", routeId, "all", range.from, range.to);
    const months = monthRange(range);
    const officialByMonth = new Map(
      repos.official.getForLineRange(name, months.from, months.to).map((m) => [monthKey(m.year, m.month), m.otpPercent]),
    );
    const response: LineTrendResponse = {
      lineId: routeId,
      from: range.from,
      to: range.to,
      interval,
      njtThresholdSeconds: NJT_OFFICIAL_THRESHOLD_SECONDS,
      points: buildTrend(rows, interval, officialByMonth),
    };
    return c.json(response);
  });

  // Full monthly history: NJT's published OTP (real, back to 2017) joined with
  // this project's monthly OTP wherever independent data exists. Newest first.
  router.get("/:lineId/monthly", (c) => {
    const { routeId, name } = requireLine(repos, c.req.param("lineId"));

    // Monthly project OTP is bucketed in SQL (GROUP BY the YYYY-MM prefix)
    // rather than pulling every daily row across all history and re-bucketing.
    const projectByMonth = new Map<string, { operated: number; onTime15: number }>();
    for (const row of repos.aggregates.getOtpMonthly("line", routeId, "all", ON_TIME_15_MIN)) {
      projectByMonth.set(row.month, { operated: row.tripsOperated, onTime15: row.onTimeCount });
    }

    const officialByMonth = new Map<string, OfficialNjtMetric>(
      repos.official.getAllForLine(name).map((m) => [`${m.year}-${String(m.month).padStart(2, "0")}`, m]),
    );

    const months = [...new Set([...projectByMonth.keys(), ...officialByMonth.keys()])].sort().reverse();
    const rows: MonthlyComparisonRow[] = months.map((month) => {
      const official = officialByMonth.get(month);
      const project = projectByMonth.get(month);
      return {
        month,
        njtOtpPercent: official?.otpPercent ?? null,
        njtOtpPercentAmtrakAdjusted: official?.otpPercentAmtrakAdjusted ?? null,
        projectOtpPercent15Min: project && project.operated > 0 ? round1((project.onTime15 / project.operated) * 100) : null,
        projectTripsOperated: project?.operated ?? 0,
      };
    });

    const response: LineMonthlyResponse = { lineId: routeId, name, rows };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  router.get("/:lineId/history", (c) => {
    const { name } = requireLine(repos, c.req.param("lineId"));
    const metrics = repos.official.getAllForLine(name);
    const response: HistoryResponse = {
      scopeLabel: name,
      seasonality: buildSeasonality(metrics),
      annual: buildAnnualOtp(metrics),
    };
    return c.json(response);
  });

  router.get("/:lineId/trips/worst", (c) => {
    const { routeId, name } = requireLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const limit = parseLimit(c.req.query("limit"), 10);
    const response: WorstTripsResponse = {
      scopeLabel: name,
      from: range.from,
      to: range.to,
      trips: repos.aggregates.worstTripsForRoute(routeId, range.from, range.to, limit).map((t) => ({
        tripId: t.tripId,
        routeId: t.routeId,
        lineName: t.lineName,
        direction: t.direction,
        terminalStopName: t.terminalStopName,
        avgTerminalDelaySeconds: round1(t.avgTerminalDelaySeconds),
        observations: t.observations,
      })),
    };
    return c.json(response);
  });

  /**
   * GET /lines/:lineId/propagation — where along the route delay accumulates.
   *
   * Built from the daily station aggregates rather than raw events, so a year
   * of history answers instantly; the trade-off is that it describes the
   * typical train rather than following individual ones.
   */
  router.get("/:lineId/propagation", (c) => {
    const { routeId, name } = requireLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const direction = c.req.query("direction") === "outbound" ? "outbound" : "inbound";

    const version = repos.gtfs.currentVersion();
    const sequence = version ? repos.gtfs.representativeStopSequence(version.versionId, routeId) : [];
    // The stored sequence runs one way; the other direction is its reverse.
    const ordered = (direction === "outbound" ? [...sequence].reverse() : sequence).map((st) => ({
      stopId: st.stopId,
      stopName: version ? (repos.gtfs.stopName(version.versionId, st.stopId) ?? st.stopId) : st.stopId,
    }));

    const stops = buildPropagation(ordered, repos.aggregates.stationDelaysForLine(name, direction, range.from, range.to));
    const { worstSegments, bestRecoveries } = rankSegments(stops, 5);
    const netAccumulatedSeconds = netAccumulated(stops);

    const response: PropagationResponse = {
      lineId: routeId,
      lineName: name,
      direction,
      from: range.from,
      to: range.to,
      stops,
      worstSegments,
      bestRecoveries,
      netAccumulatedSeconds,
      summary: summarizePropagation({ lineName: name, stops, netAccumulatedSeconds, worstSegments }),
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  router.get("/:lineId/heatmap", (c) => {
    const { routeId } = requireLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const type = parseHeatmapType(c.req.query("type"));
    const response: HeatmapResponse = {
      from: range.from,
      to: range.to,
      type,
      buckets: buildHeatmap(repos.aggregates.sumHeatmap("line", routeId, type, range.from, range.to), type),
    };
    return c.json(response);
  });

  return router;
}
