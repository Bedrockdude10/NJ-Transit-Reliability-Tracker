import type { Repositories } from "@njt/db";
import { RAIL_LINES, UNKNOWN_LINE_NAME, findLineByName } from "@njt/shared";
import { recomputeServiceDate } from "../aggregator";
import { parseCsv } from "../csv";
import { mapRailRoutes } from "../gtfs-static/route-mapping";

/**
 * One-off repair for events whose line_name holds a raw feed route id. Repoints the
 * events, then re-runs the normal aggregator so derived tables land consistently.
 */

export interface LineNameRepairResult {
  aliasesBackfilled: number;
  /** stale line name → what it was rewritten to, with the event count. */
  relabelled: { from: string; to: string; routeId: string; events: number }[];
  serviceDatesRecomputed: string[];
}

/**
 * Rebuild `gtfs_route_aliases` from each version's archived `routes.txt`. Must cover
 * every version, not just the current one: replay resolves each snapshot against the
 * schedule effective then, so a version missing aliases relabels real trips "Unknown".
 */
function backfillAliases(repos: Repositories): number {
  let written = 0;
  for (const version of repos.gtfs.allVersions()) {
    if (repos.gtfs.routeAliases(version.versionId).length > 0) continue;

    const raw = repos.gtfs.readFile(version.versionId, "routes.txt");
    if (!raw) continue;

    const { realToCanonical } = mapRailRoutes(parseCsv(new TextDecoder().decode(raw)));
    const aliases = [...realToCanonical].map(([sourceRouteId, canonicalRouteId]) => ({
      sourceRouteId,
      canonicalRouteId,
    }));
    repos.gtfs.replaceRouteAliases(version.versionId, aliases);
    written += aliases.length;
  }
  return written;
}

export interface RepairOptions {
  /** Called after each day's recompute — used to pause and let writers in. */
  betweenDates?: (serviceDate: string) => void;
}

export function repairLineNames(repos: Repositories, options?: RepairOptions): LineNameRepairResult {
  const version = repos.gtfs.currentVersion();
  if (!version) {
    return { aliasesBackfilled: 0, relabelled: [], serviceDatesRecomputed: [] };
  }

  const aliasesBackfilled = backfillAliases(repos);

  // Judged against every GTFS version ever ingested plus the catalog: NJT's feed
  // changes shape (Port Jervis is its own route in some feeds, folded into Main in
  // others), so a line absent from today's feed still has real history.
  const realLineNames = new Set([
    ...repos.gtfs.knownLineNames(),
    ...RAIL_LINES.map((l) => l.name),
    UNKNOWN_LINE_NAME,
  ]);

  const relabelled: LineNameRepairResult["relabelled"] = [];
  const affectedDates = new Set<string>();

  // A route_id holding a line name is malformed: swap the two back.
  for (const staleRouteId of repos.events.distinctRouteIds()) {
    if (!realLineNames.has(staleRouteId) || staleRouteId === UNKNOWN_LINE_NAME) continue;
    const routeId = findLineByName(staleRouteId)?.defaultRouteId ?? staleRouteId;
    for (const date of repos.events.serviceDatesForRouteId(staleRouteId)) affectedDates.add(date);
    const events = repos.events.relabelRouteId(staleRouteId, routeId, staleRouteId);
    relabelled.push({ from: staleRouteId, to: staleRouteId, routeId, events });
  }

  for (const stale of repos.events.distinctLineNames()) {
    if (realLineNames.has(stale)) continue;

    const canonicalRouteId = repos.gtfs.canonicalRouteFor(version.versionId, stale);
    const lineName = canonicalRouteId ? repos.gtfs.lineNameForRoute(version.versionId, canonicalRouteId) : null;

    // Unresolvable ids keep their route_id so the original feed value isn't lost.
    const target =
      canonicalRouteId && lineName ? { routeId: canonicalRouteId, lineName } : { routeId: stale, lineName: UNKNOWN_LINE_NAME };

    for (const date of repos.events.serviceDatesForLineName(stale)) affectedDates.add(date);
    const events = repos.events.relabelLineName(stale, target.routeId, target.lineName);
    relabelled.push({ from: stale, to: target.lineName, routeId: target.routeId, events });
  }

  // Needed for resumability: relabelling commits per statement, so a run that dies
  // mid-recompute leaves clean events with stranded aggregates and nothing to redo.
  for (const date of repos.aggregates.serviceDatesWithUnknownLineNames([...realLineNames])) {
    affectedDates.add(date);
  }

  const serviceDatesRecomputed = [...affectedDates].sort();
  for (const date of serviceDatesRecomputed) {
    recomputeServiceDate(repos, date);
    // Yield the write lock: ~80 recomputes back-to-back starve the 30s live poll.
    options?.betweenDates?.(date);
  }

  return { aliasesBackfilled, relabelled, serviceDatesRecomputed };
}
