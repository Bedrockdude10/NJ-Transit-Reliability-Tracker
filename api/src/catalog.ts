import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  findLineByName,
  lineHasAmtrakAttribution,
  type LineListItem,
  type OfficialNjtMetric,
} from "@njt/shared";
import { round1, slugify } from "./util";

/** Build a line list item, enriched with NJT's most recent published month. */
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

/** All lines in the current GTFS version (empty before any GTFS is ingested). */
export function listLines(repos: Repositories): LineListItem[] {
  const version = repos.gtfs.currentVersion();
  if (!version) return [];
  return repos.gtfs
    .routes(version.versionId)
    .filter((r) => r.mode !== "light_rail")
    .map((r) => {
      const history = repos.official.getAllForLine(r.lineName);
      return toLineItem(r.routeId, r.lineName, history.at(-1) ?? null, r.color ?? null);
    });
}

export interface ResolvedLine {
  routeId: string;
  name: string;
}

/**
 * Resolve a public lineId (the GTFS route_id) to its display name. Tolerant by
 * design: falls back to the reference catalog, then to the id itself, so any
 * range query returns (possibly empty) data rather than erroring.
 */
export function resolveLine(repos: Repositories, lineId: string): ResolvedLine {
  const version = repos.gtfs.currentVersion();
  const fromGtfs = version ? repos.gtfs.lineNameForRoute(version.versionId, lineId) : null;
  const fromCatalog = RAIL_LINES.find((l) => l.defaultRouteId === lineId)?.name;
  return { routeId: lineId, name: fromGtfs ?? fromCatalog ?? lineId };
}

/** Stations with the human line names that serve them. */
export function listStations(repos: Repositories): { stopId: string; stopName: string; lines: string[] }[] {
  const version = repos.gtfs.currentVersion();
  if (!version) return [];
  // Resolve route_id → line name once, in memory, rather than one query per
  // (station, route) pair.
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
