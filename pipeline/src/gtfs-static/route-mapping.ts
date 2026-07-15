import type { GtfsRouteRecord } from "@njt/db";
import { findLineById, findLineByName } from "@njt/shared";

/**
 * Maps GTFS rail routes onto the canonical catalog lines. Shared by both GTFS
 * ingest paths (the `import:gtfs` CLI and the pipeline's startup getGTFS sync)
 * so route_id, colors, and line attribution are derived identically.
 *
 * `route_type` for NJT rail is `"2"` (standard commuter rail, used by the
 * Mobility Database mirror) or `"113"` (the extended "Regional Rail Service"
 * type NJT emits from its own getGTFS). Light rail (`"0"`) is handled by the
 * caller — it's a separate catalog, not one of the canonical lines.
 */
export const RAIL_ROUTE_TYPES = new Set(["2", "113"]);

/**
 * GTFS `route_short_name` → canonical catalog line id. Covers NJT's own feed
 * (getGTFS: `ACRL`/`MNBTN`/`BERG`/`MAIN`/…) and the Mobility Database mirror
 * (`ATLC`/`BNTN`/`MNBN`/…). NJT groups Main, Bergen County, and Port Jervis
 * service under the Main Line route, so those collapse to `main-bergen`.
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

/**
 * Build the rail route mapping from raw `routes.txt` rows. A route matches a
 * canonical line by short name first, then by long name as a fallback. Rows
 * that aren't rail or don't map to a known line are skipped.
 */
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
