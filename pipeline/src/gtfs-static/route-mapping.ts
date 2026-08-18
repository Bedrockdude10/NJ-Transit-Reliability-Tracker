import type { GtfsRouteRecord } from "@njt/db";
import { findLineById, findLineByName } from "@njt/shared";

/**
 * NJT rail is `route_type` `"2"` from the Mobility Database mirror but `"113"`
 * ("Regional Rail Service") from NJT's own getGTFS, so both count as rail.
 */
export const RAIL_ROUTE_TYPES = new Set(["2", "113"]);

/**
 * Covers both NJT's own getGTFS short names and the Mobility Database mirror's. NJT
 * groups Main, Bergen County and Port Jervis under one route → `main-bergen`.
 */
export const SHORT_NAME_TO_LINE_ID: Record<string, string> = {
  // NJT getGTFS short names
  ACRL: "atlantic-city",
  MNBTN: "montclair-boonton",
  BERG: "main-bergen",
  MAIN: "main-bergen",
  MNE: "morris-essex",
  MNEG: "gladstone",
  NEC: "northeast-corridor",
  NJCL: "north-jersey-coast",
  PASC: "pascack-valley",
  PRIN: "princeton-shuttle",
  RARV: "raritan-valley",
  MRL: "meadowlands",
  // Mobility Database mirror aliases
  ATLC: "atlantic-city",
  BNTN: "montclair-boonton",
  BNTNM: "montclair-boonton",
  MNBN: "main-bergen",
  MNBNP: "port-jervis",
  NJCLL: "north-jersey-coast",
};

export interface RailRouteMapping {
  /** canonical routeId → catalog route record (deduped across variant routes). */
  canonicalRoutes: Map<string, GtfsRouteRecord>;
  /** source GTFS route_id → canonical routeId. */
  realToCanonical: Map<string, string>;
}

/** Matches by short name first, then long name as a fallback. */
export function mapRailRoutes(rawRoutes: readonly Record<string, string>[]): RailRouteMapping {
  const canonicalRoutes = new Map<string, GtfsRouteRecord>();
  const realToCanonical = new Map<string, string>();

  for (const row of rawRoutes) {
    if (!RAIL_ROUTE_TYPES.has(row.route_type ?? "")) continue;
    const routeId = row.route_id;
    if (!routeId) continue;

    const line =
      findLineById(SHORT_NAME_TO_LINE_ID[row.route_short_name ?? ""] ?? "") ??
      findLineByName(row.route_long_name ?? "");
    if (!line) continue;

    realToCanonical.set(routeId, line.defaultRouteId);
    if (!canonicalRoutes.has(line.defaultRouteId)) {
      canonicalRoutes.set(line.defaultRouteId, {
        routeId: line.defaultRouteId,
        lineName: line.name,
        color: row.route_color || null,
        mode: "rail",
      });
    }
  }

  return { canonicalRoutes, realToCanonical };
}
