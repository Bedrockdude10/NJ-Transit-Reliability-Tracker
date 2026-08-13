import type { Repositories } from "@njt/db";
import {
  SYSTEM_SCOPE_ID,
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
import { ALL_MONTHS, monthRange, resolveRange } from "../dates";
import { resolveOfficialWindow } from "../official-window";
import { CACHE_CONTROL_DAILY, parseHeatmapType } from "../util";

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
