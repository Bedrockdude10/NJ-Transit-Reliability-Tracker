import type { Repositories } from "@njt/db";
import { monthLabel, type LightRailLineMdbf, type LightRailSummaryResponse, type YearMonth } from "@njt/shared";
import { Hono } from "hono";
import { averageLightRailOtp } from "../aggregation";
import { monthRange, resolveRange, type MonthRange } from "../dates";
import { resolveOfficialWindow } from "../official-window";
import { CACHE_CONTROL_DAILY } from "../util";

function monthSpanOf(rows: readonly YearMonth[]): MonthRange {
  const index = (m: YearMonth) => m.year * 12 + m.month;
  let from = rows[0]!;
  let to = rows[0]!;
  for (const r of rows) {
    if (index(r) < index(from)) from = r;
    if (index(r) > index(to)) to = r;
  }
  return { from: { year: from.year, month: from.month }, to: { year: to.year, month: to.month } };
}

export function lightRailRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/summary", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const months = monthRange(range);

    const otp = resolveOfficialWindow(
      months,
      (from, to) => repos.lightRail.getOtpForRange(from, to),
      () => repos.lightRail.latestOtpMonth(),
    );
    const otpRows = otp.metrics;
    const otpPercent = averageLightRailOtp(otpRows);

    // Reuse the months OTP resolved to; falling back independently would mix
    // periods in one panel.
    const mdbfMonths = otp.coverage?.outsideRequestedRange ? monthSpanOf(otpRows) : months;
    const byLine = new Map<string, { sum: number; count: number }>();
    for (const row of repos.lightRail.getMdbfForRange(mdbfMonths.from, mdbfMonths.to)) {
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
      otpTrend: otpRows.map((r) => ({ month: monthLabel(r.year, r.month), otpPercent: r.otpPercent })),
      coverage: otp.coverage,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
