/**
 * Reference catalog of NJ Transit commuter rail lines.
 *
 * IMPORTANT: the authoritative line list at runtime is data-driven — it comes
 * from distinct `route_id`s observed in the ingested GTFS static `routes.txt`.
 * This catalog exists for (a) friendly display names and slugs, (b) seeding
 * realistic demo data, and (c) flagging the two lines that carry Amtrak-
 * attributed delay. Real `routeId`s are resolved at ingest time, so callers
 * should treat `routeId` here as a best-effort default, not ground truth.
 */

export interface RailLine {
  /** Stable URL-safe slug used in the API and deep links. */
  id: string;
  /** Human-readable line name as NJT publishes it. */
  name: string;
  /** Short label for compact UI. */
  shortName: string;
  /** Best-effort GTFS route_id default (verified/overridden from routes.txt at ingest). */
  defaultRouteId: string;
  /** Whether NJT attributes some of this line's delay to Amtrak (NEC / NJCL). */
  hasAmtrakAttribution: boolean;
}

export const RAIL_LINES: readonly RailLine[] = [
  { id: "northeast-corridor", name: "Northeast Corridor Line", shortName: "NEC", defaultRouteId: "NE", hasAmtrakAttribution: true },
  { id: "north-jersey-coast", name: "North Jersey Coast Line", shortName: "NJCL", defaultRouteId: "NC", hasAmtrakAttribution: true },
  { id: "morris-essex", name: "Morris & Essex Line", shortName: "M&E", defaultRouteId: "ME", hasAmtrakAttribution: false },
  { id: "montclair-boonton", name: "Montclair-Boonton Line", shortName: "MOBO", defaultRouteId: "MC", hasAmtrakAttribution: false },
  { id: "gladstone", name: "Gladstone Branch", shortName: "GLAD", defaultRouteId: "GL", hasAmtrakAttribution: false },
  { id: "main-bergen", name: "Main/Bergen County Line", shortName: "MNBN", defaultRouteId: "MN", hasAmtrakAttribution: false },
  { id: "pascack-valley", name: "Pascack Valley Line", shortName: "PASC", defaultRouteId: "PV", hasAmtrakAttribution: false },
  { id: "raritan-valley", name: "Raritan Valley Line", shortName: "RARV", defaultRouteId: "RV", hasAmtrakAttribution: false },
  { id: "atlantic-city", name: "Atlantic City Line", shortName: "ACRL", defaultRouteId: "AC", hasAmtrakAttribution: false },
  { id: "princeton-shuttle", name: "Princeton Shuttle (Dinky)", shortName: "PRIN", defaultRouteId: "PR", hasAmtrakAttribution: false },
] as const;

const BY_ID = new Map(RAIL_LINES.map((l) => [l.id, l]));
const BY_NAME = new Map(RAIL_LINES.map((l) => [l.name, l]));

export function findLineById(id: string): RailLine | undefined {
  return BY_ID.get(id);
}

export function findLineByName(name: string): RailLine | undefined {
  return BY_NAME.get(name);
}

/** Whether a line (by display name) carries NJT-attributed Amtrak delay. */
export function lineHasAmtrakAttribution(name: string): boolean {
  return BY_NAME.get(name)?.hasAmtrakAttribution ?? false;
}
