/**
 * Display names, slugs, and Amtrak attribution for the rail lines. NOT the
 * authoritative line list: that comes from `route_id`s observed in the ingested
 * GTFS `routes.txt`, so `defaultRouteId` here is a fallback, not ground truth.
 */

export interface RailLine {
  /** URL-safe slug used in the API and deep links. */
  id: string;
  /** As NJT publishes it. */
  name: string;
  shortName: string;
  defaultRouteId: string;
  /** NJT attributes some of this line's delay to Amtrak (NEC / NJCL only). */
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
  { id: "port-jervis", name: "Port Jervis Line", shortName: "PJ", defaultRouteId: "PJ", hasAmtrakAttribution: false },
  { id: "meadowlands", name: "Meadowlands Rail Line", shortName: "MDWL", defaultRouteId: "MR", hasAmtrakAttribution: false },
] as const;

const BY_ID = new Map(RAIL_LINES.map((l) => [l.id, l]));
const BY_NAME = new Map(RAIL_LINES.map((l) => [l.name, l]));

export function findLineById(id: string): RailLine | undefined {
  return BY_ID.get(id);
}

export function findLineByName(name: string): RailLine | undefined {
  return BY_NAME.get(name);
}

export function lineHasAmtrakAttribution(name: string): boolean {
  return BY_NAME.get(name)?.hasAmtrakAttribution ?? false;
}
