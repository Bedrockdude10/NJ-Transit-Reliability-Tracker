import type { Repositories } from "@njt/db";
import type { LightRailLineMdbf, LightRailSummaryResponse } from "@njt/shared";
import { Hono } from "hono";
import { averageLightRailOtp } from "../aggregation";
import { monthRange, resolveRange } from "../dates";
import { CACHE_CONTROL_DAILY } from "../util";

/** GET /lightrail/summary — systemwide light-rail OTP + per-line MDBF. */
export function lightRailRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/summary", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const months = monthRange(range);

    const otpRows = repos.lightRail.getOtpForRange(months.from, months.to);
    const otpPercent = averageLightRailOtp(otpRows);

    const byLine = new Map<string, { sum: number; count: number }>();
    for (const row of repos.lightRail.getMdbfForRange(months.from, months.to)) {
      const acc = byLine.get(row.lineName) ?? { sum: 0, count: 0 };
      acc.sum += row.mdbf;
      acc.count += 1;
      byLine.set(row.lineName, acc);
    }
    const lines: LightRailLineMdbf[] = [...byLine.entries()]
      .map(([lineName, a]) => ({ lineName, avgMdbf: Math.round(a.sum / a.count), monthsCovered: a.count }))
      .sort((a, b) => a.lineName.localeCompare(b.lineName));

    const response: LightRailSummaryResponse = {
      from: range.from,
      to: range.to,
      otpPercent,
      monthsCovered: otpRows.length,
      lines,
      otpTrend: otpRows.map((r) => ({ month: `${r.year}-${String(r.month).padStart(2, "0")}`, otpPercent: r.otpPercent })),
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
