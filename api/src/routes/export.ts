import type { Repositories } from "@njt/db";
import { SYSTEM_SCOPE_ID } from "@njt/shared";
import { Hono, type Context } from "hono";
import { buildDistributionResult, buildOfficialComparison, buildOtpSummary, mergeCountMaps } from "../aggregation";
import { resolveLine, stopName } from "../catalog";
import { summaryToCsv, toCsv } from "../csv";
import { monthRange, resolveRange, type DateRange } from "../dates";
import { badRequest, round1 } from "../util";

function csvResponse(c: Context, filename: string, body: string): Response {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(body);
}

/** GET /export — same data as the summary endpoints, as a downloadable CSV. */
export function exportRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const entity = c.req.query("entity");
    const id = c.req.query("id");
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const months = monthRange(range);

    if (entity === "system") {
      const summary = buildOtpSummary(
        repos.aggregates.getOtpDailyRows("system", SYSTEM_SCOPE_ID, "all", range.from, range.to),
        repos.aggregates.getDelayDistributionDailyRows("system", SYSTEM_SCOPE_ID, range.from, range.to),
      );
      const official = buildOfficialComparison(repos.official.getAllForRange(months.from, months.to));
      return csvResponse(c, `system_${range.from}_${range.to}.csv`, summaryToCsv("System", range, summary, official));
    }

    if (entity === "line") {
      if (!id) badRequest("id is required for entity=line");
      const { routeId, name } = resolveLine(repos, id);
      const summary = buildOtpSummary(
        repos.aggregates.getOtpDailyRows("line", routeId, "all", range.from, range.to),
        repos.aggregates.getDelayDistributionDailyRows("line", routeId, range.from, range.to),
      );
      const official = buildOfficialComparison(repos.official.getForLineRange(name, months.from, months.to));
      return csvResponse(c, `line_${routeId}_${range.from}_${range.to}.csv`, summaryToCsv(name, range, summary, official));
    }

    if (entity === "station") {
      if (!id) badRequest("id is required for entity=station");
      return csvResponse(c, `station_${id}_${range.from}_${range.to}.csv`, stationCsv(repos, id, range));
    }

    return badRequest("entity must be one of: system, line, station");
  });

  return router;
}

function stationCsv(repos: Repositories, stopId: string, range: DateRange): string {
  const byLineDir = repos.aggregates.stationByLineDirection(stopId, range.from, range.to);
  const dist = buildDistributionResult(
    mergeCountMaps(repos.aggregates.getStationDistributionRows(stopId, range.from, range.to).map((r) => r.counts)),
  );
  return toCsv([
    [`NJ Transit Reliability — Station ${stopName(repos, stopId)}`],
    ["Range", range.from, range.to],
    [],
    ["Line", "Direction", "Avg arrival delay (s)", "Observations"],
    ...byLineDir.map((r): (string | number)[] => [
      r.lineName,
      r.direction,
      r.observations > 0 ? round1(r.sumArrivalDelaySeconds / r.observations) : 0,
      r.observations,
    ]),
    [],
    ["Delay bucket", "Count"],
    ...dist.map((b): (string | number)[] => [b.label, b.count]),
  ]);
}
