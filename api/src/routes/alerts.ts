import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  type AlertFrequencyLine,
  type AlertFrequencyResponse,
  type AlertListItem,
  type AlertListResponse,
} from "@njt/shared";
import { gtfsStopTimeToEpochSeconds, startOfLocalDayEpochSeconds } from "@njt/shared/zoned";
import { Hono } from "hono";
import { resolveRange } from "../dates";
import { parsePositiveInt } from "../util";

function startOfDayMs(date: string): number {
  return startOfLocalDayEpochSeconds(date) * 1000;
}
function endOfDayMs(date: string): number {
  return gtfsStopTimeToEpochSeconds(date, "24:00:00") * 1000;
}

export function alertRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const page = parsePositiveInt(c.req.query("page"), 1);
    const pageSize = parsePositiveInt(c.req.query("pageSize"), 50, 200);

    const line = c.req.query("line");
    const effectType = c.req.query("effect_type");
    const { alerts, total } = repos.alerts.list({
      ...(line !== undefined ? { route: line } : {}),
      ...(effectType !== undefined ? { effectType } : {}),
      fromMs: startOfDayMs(range.from),
      toMs: endOfDayMs(range.to),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const response: AlertListResponse = {
      alerts: alerts.map(
        (a): AlertListItem => ({
          alertId: a.alertId,
          affectedRoutes: a.affectedRoutes,
          affectedStops: a.affectedStops,
          headerText: a.headerText,
          descriptionText: a.descriptionText,
          effectType: a.effectType,
          activeFrom: a.activeFrom,
          activeTo: a.activeTo,
          ingestedAtMs: a.ingestedAtMs,
        }),
      ),
      page,
      pageSize,
      total,
    };
    return c.json(response);
  });

  router.get("/frequency", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const rows = repos.alerts.frequency(startOfDayMs(range.from), endOfDayMs(range.to));

    // Unlike `resolveLine`, echo an unknown route_id rather than 404ing: alert
    // routes come from NJT's feed and may name routes outside the catalog.
    const version = repos.gtfs.currentVersion();
    const nameByRoute = new Map(
      version ? repos.gtfs.routes(version.versionId).map((r) => [r.routeId, r.lineName] as const) : [],
    );
    const resolveName = (routeId: string): string =>
      nameByRoute.get(routeId) ?? RAIL_LINES.find((l) => l.defaultRouteId === routeId)?.name ?? routeId;

    const byRoute = new Map<string, AlertFrequencyLine>();
    for (const row of rows) {
      const lineName = resolveName(row.route);
      const entry = byRoute.get(row.route) ?? { lineName, counts: {}, total: 0 };
      entry.counts[row.effectType] = (entry.counts[row.effectType] ?? 0) + row.count;
      entry.total += row.count;
      byRoute.set(row.route, entry);
    }

    const response: AlertFrequencyResponse = {
      from: range.from,
      to: range.to,
      byLine: [...byRoute.values()].sort((a, b) => b.total - a.total),
    };
    return c.json(response);
  });

  return router;
}
