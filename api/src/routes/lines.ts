import type { Repositories } from "@njt/db";
import {
  HEATMAP_TYPES,
  NJT_OFFICIAL_THRESHOLD_SECONDS,
  parseDateString,
  type HeatmapResponse,
  type HeatmapType,
  type LineListResponse,
  type LineMonthlyResponse,
  type LineSummaryResponse,
  type LineTrendResponse,
  type MonthlyComparisonRow,
  type OfficialNjtMetric,
  type OtpDailyRow,
  type TrendPoint,
  type WorstTripsResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { buildCancellations, buildHeatmap, buildOfficialComparison, buildOtpSummary } from "../aggregation";
import { listLines, resolveLine } from "../catalog";
import { monthRange, resolveRange } from "../dates";
import { badRequest, round1 } from "../util";

const ON_TIME_15_MIN = "900";

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
    return officialByMonth.get(`${year}-${month}`) ?? null;
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

function parseLimit(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100);
}

function parseHeatmapType(value: string | undefined): HeatmapType {
  const type = value ?? "hour_of_day";
  if (!HEATMAP_TYPES.includes(type as HeatmapType)) badRequest(`type must be one of ${HEATMAP_TYPES.join(", ")}`);
  return type as HeatmapType;
}

export function lineRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const response: LineListResponse = { lines: listLines(repos) };
    return c.json(response);
  });

  router.get("/:lineId/summary", (c) => {
    const { routeId, name } = resolveLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const dist = repos.aggregates.getDelayDistributionDailyRows("line", routeId, range.from, range.to);
    const otpFor = (dir: "all" | "inbound" | "outbound") =>
      repos.aggregates.getOtpDailyRows("line", routeId, dir, range.from, range.to);
    const months = monthRange(range);
    const officialMetrics = repos.official.getForLineRange(name, months.from, months.to);

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
    };
    return c.json(response);
  });

  router.get("/:lineId/trend", (c) => {
    const { routeId, name } = resolveLine(repos, c.req.param("lineId"));
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const interval = c.req.query("interval") === "weekly" ? "weekly" : "daily";
    const rows = repos.aggregates.getOtpDailyRows("line", routeId, "all", range.from, range.to);
    const months = monthRange(range);
    const officialByMonth = new Map(
      repos.official.getForLineRange(name, months.from, months.to).map((m) => [`${m.year}-${m.month}`, m.otpPercent]),
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
    const { routeId, name } = resolveLine(repos, c.req.param("lineId"));

    const projectByMonth = new Map<string, { operated: number; onTime15: number }>();
    for (const row of repos.aggregates.getOtpDailyRows("line", routeId, "all", "2017-01-01", "2100-01-01")) {
      const month = row.serviceDate.slice(0, 7);
      const acc = projectByMonth.get(month) ?? { operated: 0, onTime15: 0 };
      acc.operated += row.tripsOperated;
      acc.onTime15 += row.onTimeCounts[ON_TIME_15_MIN] ?? 0;
      projectByMonth.set(month, acc);
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
    return c.json(response);
  });

  router.get("/:lineId/trips/worst", (c) => {
    const { routeId, name } = resolveLine(repos, c.req.param("lineId"));
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

  router.get("/:lineId/heatmap", (c) => {
    const { routeId } = resolveLine(repos, c.req.param("lineId"));
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
