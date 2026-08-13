import type { Repositories } from "@njt/db";
import {
  MPS_TO_MPH,
  findLineByName,
  type MapLine,
  type MapResponse,
  type MapStation,
  type MapVehicle,
  type MapVehiclesResponse,
  type OfficialNjtMetric,
  type OtpDailyRow,
} from "@njt/shared";
import { Hono } from "hono";
import { ON_TIME_15_MIN, averageLightRailOtp, buildOfficialComparison } from "../aggregation";
import { requireLine } from "../catalog";
import { monthRange, resolveRange } from "../dates";
import { CACHE_CONTROL_DAILY, round1 } from "../util";

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

    // Systemwide light-rail OTP (one figure, shared by the light rail lines).
    const lightRailOtp = averageLightRailOtp(repos.lightRail.getOtpForRange(months.from, months.to));

    // All lines' official metrics in one ranged query, grouped by line name in
    // memory (rather than one getForLineRange per route).
    const officialByLine = new Map<string, OfficialNjtMetric[]>();
    for (const m of repos.official.getAllForRange(months.from, months.to)) {
      const list = officialByLine.get(m.lineName);
      if (list) list.push(m);
      else officialByLine.set(m.lineName, [m]);
    }

    // All lines' OTP daily rows in one ranged query, grouped by scope_id
    // (route id) in memory — rather than one getOtpDailyRows per route (N+1).
    const otpByRoute = new Map<string, OtpDailyRow[]>();
    for (const row of repos.aggregates.getOtpDailyRowsForScope("line", "all", range.from, range.to)) {
      const list = otpByRoute.get(row.scopeId);
      if (list) list.push(row);
      else otpByRoute.set(row.scopeId, [row]);
    }

    const lines: MapLine[] = repos.gtfs.routes(version.versionId).map((route) => {
      const path = repos.gtfs.representativeStopSequence(version.versionId, route.routeId).map((s) => s.stopId);
      for (const id of path) stationIds.add(id);
      const isLightRail = route.mode === "light_rail";

      const official = isLightRail
        ? null
        : buildOfficialComparison(officialByLine.get(route.lineName) ?? []);
      const otpRows = isLightRail ? [] : (otpByRoute.get(route.routeId) ?? []);
      const operated = otpRows.reduce((s, r) => s + r.tripsOperated, 0);
      const onTime15 = otpRows.reduce((s, r) => s + (r.onTimeCounts[ON_TIME_15_MIN] ?? 0), 0);

      return {
        lineId: route.routeId,
        name: route.lineName,
        shortName: findLineByName(route.lineName)?.shortName ?? route.routeId,
        mode: isLightRail ? "light_rail" : "rail",
        color: route.color || "8895A7",
        njtOtpPercent: isLightRail ? lightRailOtp : (official?.otpPercent ?? null),
        projectOtpPercent15Min: operated > 0 ? round1((onTime15 / operated) * 100) : null,
        path,
      };
    });

    const stations: MapStation[] = repos.gtfs
      .allStops(version.versionId)
      .filter((s) => s.lat !== null && s.lon !== null && stationIds.has(s.stopId))
      .map((s) => ({ stopId: s.stopId, stopName: s.stopName, lat: s.lat as number, lon: s.lon as number }));

    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json({ from: range.from, to: range.to, stations, lines } satisfies MapResponse);
  });

  // Live train positions. Unlike the rest of the map this is not cacheable —
  // it changes every poll — so it's a separate route with no-store.
  router.get("/vehicles", (c) => {
    const now = Date.now();
    const routeId = c.req.query("lineId");
    const resolved = routeId ? requireLine(repos, routeId) : null;

    const stored = repos.vehicles.all(resolved?.routeId);
    const vehicles: MapVehicle[] = stored.map((v) => ({
      vehicleId: v.vehicleId,
      tripId: v.tripId,
      routeId: v.routeId,
      lineName: v.lineName,
      direction: v.direction,
      latitude: v.latitude,
      longitude: v.longitude,
      bearing: v.bearing,
      speedMph: v.speedMetersPerSecond === null ? null : round1(v.speedMetersPerSecond * MPS_TO_MPH),
      stopId: v.stopId,
      stopName: v.stopName,
      status: v.status,
      reportedAt: v.reportedAt,
      ageSeconds: v.reportedAt === null ? null : Math.max(0, Math.round(now / 1000 - v.reportedAt)),
    }));

    const lastIngestedAtMs = stored.length > 0 ? Math.max(...stored.map((v) => v.ingestedAtMs)) : null;

    c.header("Cache-Control", "no-store");
    return c.json({ vehicles, lastIngestedAtMs, generatedAtMs: now } satisfies MapVehiclesResponse);
  });

  return router;
}
