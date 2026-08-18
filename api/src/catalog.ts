import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  findLineByName,
  lineHasAmtrakAttribution,
  type LineListItem,
  type OfficialNjtMetric,
} from "@njt/shared";
import { notFound, round1, slugify } from "./util";

export function toLineItem(
  routeId: string,
  lineName: string,
  latest: OfficialNjtMetric | null,
  color: string | null = null,
): LineListItem {
  const catalog = findLineByName(lineName);
  const scheduled = latest ? latest.tripsOperated + latest.cancellations : 0;
  return {
    id: routeId,
    slug: catalog?.id ?? slugify(lineName),
    name: lineName,
    shortName: catalog?.shortName ?? lineName,
    hasAmtrakAttribution: lineHasAmtrakAttribution(lineName),
    color,
    njtOtpPercent: latest?.otpPercent ?? null,
    njtCancellationRatePercent: latest && scheduled > 0 ? round1((latest.cancellations / scheduled) * 100) : null,
    njtLatestMonth: latest ? `${latest.year}-${String(latest.month).padStart(2, "0")}` : null,
  };
}

export function listLines(repos: Repositories): LineListItem[] {
  const version = repos.gtfs.currentVersion();
  if (!version) return [];
  // One query for every line's latest month, not one per line (N+1).
  const latestByLine = repos.official.latestPerLine();
  return repos.gtfs
    .routes(version.versionId)
    .filter((r) => r.mode !== "light_rail")
    .map((r) => toLineItem(r.routeId, r.lineName, latestByLine.get(r.lineName) ?? null, r.color ?? null));
}

export interface ResolvedLine {
  routeId: string;
  name: string;
}

/** Must stay identical to the slug `toLineItem` publishes. */
function slugFor(lineName: string): string {
  return findLineByName(lineName)?.id ?? slugify(lineName);
}

/**
 * Accepts either form `/lines` publishes: the GTFS `route_id` or the catalog slug.
 * Null when neither matches — callers must 404, not serve a zero-filled summary.
 */
export function resolveLine(repos: Repositories, lineId: string): ResolvedLine | null {
  const version = repos.gtfs.currentVersion();

  const fromGtfs = version ? repos.gtfs.lineNameForRoute(version.versionId, lineId) : null;
  if (fromGtfs) return { routeId: lineId, name: fromGtfs };

  // Map a slug back through the live GTFS routes, so the returned route_id
  // matches the real-time feed.
  if (version) {
    for (const route of repos.gtfs.routes(version.versionId)) {
      if (route.mode === "light_rail") continue;
      if (slugFor(route.lineName) === lineId) return { routeId: route.routeId, name: route.lineName };
    }
  }

  // Fall back to the reference catalog so ids resolve before any GTFS is
  // ingested; its `defaultRouteId` is best-effort (see shared/lines.ts).
  const catalog = RAIL_LINES.find((l) => l.defaultRouteId === lineId || l.id === lineId);
  if (catalog) return { routeId: catalog.defaultRouteId, name: catalog.name };

  return null;
}

export function requireLine(repos: Repositories, lineId: string): ResolvedLine {
  const line = resolveLine(repos, lineId);
  if (!line) notFound(`unknown line "${lineId}"`);
  return line;
}

export function listStations(repos: Repositories): { stopId: string; stopName: string; lines: string[] }[] {
  const version = repos.gtfs.currentVersion();
  if (!version) return [];
  // Resolve route_id → line name once, not one query per (station, route) pair.
  const lineByRoute = new Map(repos.gtfs.routes(version.versionId).map((r) => [r.routeId, r.lineName]));
  return repos.gtfs.stationsWithLines(version.versionId).map((station) => ({
    stopId: station.stopId,
    stopName: station.stopName,
    lines: [...new Set(station.lines.map((routeId) => lineByRoute.get(routeId) ?? routeId))],
  }));
}

export function stopName(repos: Repositories, stopId: string): string {
  const version = repos.gtfs.currentVersion();
  return (version && repos.gtfs.stopName(version.versionId, stopId)) || stopId;
}
