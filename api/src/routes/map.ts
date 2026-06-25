import type { Repositories } from "@njt/db";
import { findLineByName, type MapLine, type MapResponse, type MapStation } from "@njt/shared";
import { Hono } from "hono";
import { buildOfficialComparison } from "../aggregation";
import { monthRange, resolveRange } from "../dates";
import { round1 } from "../util";

const ON_TIME_15_MIN = "900";

/** GET /map — real network geometry + per-line reliability for the system map. */
export function mapRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const version = repos.gtfs.currentVersion();
    if (!version) {
      return c.json({ from: range.from, to: range.to, stations: [], lines: [] } satisfies MapResponse);
    }
    const months = monthRange(range);
    const stationIds = new Set<string>();

    const lines: MapLine[] = repos.gtfs.routes(version.versionId).map((route) => {
      const path = repos.gtfs.representativeStopSequence(version.versionId, route.routeId).map((s) => s.stopId);
      for (const id of path) stationIds.add(id);

      const official = buildOfficialComparison(repos.official.getForLineRange(route.lineName, months.from, months.to));
      const otpRows = repos.aggregates.getOtpDailyRows("line", route.routeId, "all", range.from, range.to);
      const operated = otpRows.reduce((s, r) => s + r.tripsOperated, 0);
      const onTime15 = otpRows.reduce((s, r) => s + (r.onTimeCounts[ON_TIME_15_MIN] ?? 0), 0);

      return {
        lineId: route.routeId,
        name: route.lineName,
        shortName: findLineByName(route.lineName)?.shortName ?? route.routeId,
        color: route.color || "8895A7",
        njtOtpPercent: official?.otpPercent ?? null,
        projectOtpPercent15Min: operated > 0 ? round1((onTime15 / operated) * 100) : null,
        path,
      };
    });

    const stations: MapStation[] = repos.gtfs
      .allStops(version.versionId)
      .filter((s) => s.lat !== null && s.lon !== null && stationIds.has(s.stopId))
      .map((s) => ({ stopId: s.stopId, stopName: s.stopName, lat: s.lat as number, lon: s.lon as number }));

    return c.json({ from: range.from, to: range.to, stations, lines } satisfies MapResponse);
  });

  return router;
}
