import type { Repositories } from "@njt/db";
import {
  RAIL_LINES,
  findLineByName,
  lineHasAmtrakAttribution,
  type LineListItem,
} from "@njt/shared";
import { slugify } from "./util";

/** Build a line list item from a route_id + its GTFS line name. */
export function toLineItem(routeId: string, lineName: string): LineListItem {
  const catalog = findLineByName(lineName);
  return {
    id: routeId,
    slug: catalog?.id ?? slugify(lineName),
    name: lineName,
    shortName: catalog?.shortName ?? lineName,
    hasAmtrakAttribution: lineHasAmtrakAttribution(lineName),
  };
}

/** All lines in the current GTFS version (empty before any GTFS is ingested). */
export function listLines(repos: Repositories): LineListItem[] {
  const version = repos.gtfs.currentVersion();
  if (!version) return [];
  return repos.gtfs.routes(version.versionId).map((r) => toLineItem(r.routeId, r.lineName));
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
  return repos.gtfs.stationsWithLines(version.versionId).map((station) => ({
    stopId: station.stopId,
    stopName: station.stopName,
    lines: [...new Set(station.lines.map((routeId) => repos.gtfs.lineNameForRoute(version.versionId, routeId) ?? routeId))],
  }));
}

export function stopName(repos: Repositories, stopId: string): string {
  const version = repos.gtfs.currentVersion();
  return (version && repos.gtfs.stopName(version.versionId, stopId)) || stopId;
}
