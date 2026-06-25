import type { Repositories } from "@njt/db";
import {
  HEATMAP_TYPES,
  SYSTEM_SCOPE_ID,
  type HeatmapResponse,
  type HeatmapType,
  type SystemSummaryResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { buildHeatmap, buildOfficialComparison, buildOtpSummary } from "../aggregation";
import { monthRange, resolveRange } from "../dates";
import { badRequest } from "../util";

function parseHeatmapType(value: string | undefined): HeatmapType {
  const type = value ?? "hour_of_day";
  if (!HEATMAP_TYPES.includes(type as HeatmapType)) {
    badRequest(`type must be one of ${HEATMAP_TYPES.join(", ")}`);
  }
  return type as HeatmapType;
}

/** /system/summary and /system/heatmap — system-wide rollups. */
export function systemRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/summary", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const otp = repos.aggregates.getOtpDailyRows("system", SYSTEM_SCOPE_ID, "all", range.from, range.to);
    const dist = repos.aggregates.getDelayDistributionDailyRows("system", SYSTEM_SCOPE_ID, range.from, range.to);
    const months = monthRange(range);
    const response: SystemSummaryResponse = {
      from: range.from,
      to: range.to,
      overall: buildOtpSummary(otp, dist),
      njtOfficial: buildOfficialComparison(repos.official.getAllForRange(months.from, months.to)),
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
