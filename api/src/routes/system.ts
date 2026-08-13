import type { Repositories } from "@njt/db";
import {
  SYSTEM_SCOPE_ID,
  addDays,
  toLocalDateString,
  type OtpDailyRow,
  type TrendsResponse,
  type HeatmapResponse,
  type HistoryResponse,
  type SystemSummaryResponse,
} from "@njt/shared";
import { Hono } from "hono";
import {
  buildAnnualOtp,
  buildCancellations,
  buildFleetMdbf,
  buildHeatmap,
  buildMdbfAnnual,
  buildOfficialComparison,
  buildOtpSummary,
  buildSeasonality,
} from "../aggregation";
import { listLines } from "../catalog";
import { ALL_MONTHS, monthRange, resolveRange } from "../dates";
import { buildLineTrend, sumPeriod, summarizeTrends } from "../trends";
import { resolveOfficialWindow } from "../official-window";
import { CACHE_CONTROL_DAILY, parseBoundedInt, parseHeatmapType } from "../util";

/** A fortnight against the fortnight before — long enough to smooth a bad week. */
const DEFAULT_TREND_DAYS = 14;
/** Compare at the strict threshold the project leads with, not NJT's 6 minutes. */
const TREND_THRESHOLD = "300";

/** /system/summary and /system/heatmap — system-wide rollups. */
export function systemRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/summary", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const otp = repos.aggregates.getOtpDailyRows("system", SYSTEM_SCOPE_ID, "all", range.from, range.to);
    const dist = repos.aggregates.getDelayDistributionDailyRows("system", SYSTEM_SCOPE_ID, range.from, range.to);
    const months = monthRange(range);

    // NJT publishes monthly and in arrears, so the default 30-day window has no
    // published months — fall back to the newest that exist and say so.
    const official = resolveOfficialWindow(
      months,
      (from, to) => repos.official.getAllForRange(from, to),
      () => repos.official.latestMonth(),
    );
    const mdbf = resolveOfficialWindow(
      months,
      (from, to) => repos.official.getMdbfForRange(from, to),
      () => repos.official.latestMdbfMonth(),
    );

    const response: SystemSummaryResponse = {
      from: range.from,
      to: range.to,
      overall: buildOtpSummary(otp, dist),
      njtOfficial: buildOfficialComparison(official.metrics),
      njtCancellations: buildCancellations(official.metrics),
      fleetMdbf: buildFleetMdbf(mdbf.metrics),
      officialCoverage: official.coverage,
      fleetMdbfCoverage: mdbf.coverage,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  /**
   * GET /system/trends — which lines have measurably changed.
   *
   * Compares the last `days` against the `days` immediately before, per line.
   * The comparison is screened for noise (see ../trends.ts) so a quiet line
   * cannot top the list on a handful of trips.
   */
  router.get("/trends", (c) => {
    const days = parseBoundedInt(c.req.query("days"), DEFAULT_TREND_DAYS, 3, 180);
    const today = toLocalDateString(Math.floor(Date.now() / 1000));

    const recentFrom = addDays(today, -(days - 1));
    const priorTo = addDays(recentFrom, -1);
    const priorFrom = addDays(priorTo, -(days - 1));

    // Two ranged queries across every line, grouped in memory — not one pair
    // of queries per line.
    const byScope = (from: string, to: string) => {
      const map = new Map<string, OtpDailyRow[]>();
      for (const row of repos.aggregates.getOtpDailyRowsForScope("line", "all", from, to)) {
        const list = map.get(row.scopeId);
        if (list) list.push(row);
        else map.set(row.scopeId, [row]);
      }
      return map;
    };
    const recentRows = byScope(recentFrom, today);
    const priorRows = byScope(priorFrom, priorTo);

    const lines = listLines(repos)
      .map((line) =>
        buildLineTrend({
          lineId: line.id,
          lineName: line.name,
          recent: sumPeriod(recentRows.get(line.id) ?? [], TREND_THRESHOLD),
          prior: sumPeriod(priorRows.get(line.id) ?? [], TREND_THRESHOLD),
        }),
      )
      // Worsening first: the list exists to surface problems.
      .sort((a, b) => (a.deltaPoints ?? 0) - (b.deltaPoints ?? 0));

    const response: TrendsResponse = {
      days,
      recentFrom,
      recentTo: today,
      priorFrom,
      priorTo,
      thresholdSeconds: Number(TREND_THRESHOLD),
      lines,
      summary: summarizeTrends(lines, days),
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  router.get("/history", (c) => {
    const metrics = repos.official.getAllForRange(ALL_MONTHS.from, ALL_MONTHS.to);
    const response: HistoryResponse = {
      scopeLabel: "System",
      seasonality: buildSeasonality(metrics),
      annual: buildAnnualOtp(metrics),
      mdbfAnnual: buildMdbfAnnual(repos.official.getMdbfForRange(ALL_MONTHS.from, ALL_MONTHS.to)),
    };
    return c.json(response);
  });

  router.get("/heatmap", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const type = parseHeatmapType(c.req.query("type"));
    const buckets = repos.aggregates.sumHeatmap("system", SYSTEM_SCOPE_ID, type, range.from, range.to);
    const response: HeatmapResponse = {
      from: range.from,
      to: range.to,
      type,
      buckets: buildHeatmap(buckets, type),
    };
    return c.json(response);
  });

  return router;
}
