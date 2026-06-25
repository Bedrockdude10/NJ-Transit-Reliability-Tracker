import type { Repositories } from "@njt/db";
import type { LightRailLineMdbf, LightRailSummaryResponse } from "@njt/shared";
import { Hono } from "hono";
import { monthRange, resolveRange } from "../dates";
import { round1 } from "../util";

/** GET /lightrail/summary — systemwide light-rail OTP + per-line MDBF. */
export function lightRailRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/summary", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const months = monthRange(range);

    const otpRows = repos.lightRail.getOtpForRange(months.from, months.to);
    const otpPercent = otpRows.length > 0 ? round1(otpRows.reduce((s, r) => s + r.otpPercent, 0) / otpRows.length) : null;

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
    return c.json(response);
  });

  return router;
}
