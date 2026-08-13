import type { Repositories } from "@njt/db";
import { RAIL_LINES, UNKNOWN_LINE_NAME, findLineByName } from "@njt/shared";
import { recomputeServiceDate } from "../aggregator";
import { parseCsv } from "../csv";
import { mapRailRoutes } from "../gtfs-static/route-mapping";

/**
 * One-off repair for events recorded before the RT parser could resolve the
 * feed's *source* route ids.
 *
 * GTFS static ingest collapses variant routes onto canonical catalog lines, so
 * `gtfs_routes` holds only canonical ids. A real-time trip missing from the
 * static schedule had no trip row to resolve through, so the raw feed id was
 * stored as the line name — a station reporting service on a line called "10",
 * and its delays split off from the real line's aggregates.
 *
 * The fix repoints the *events* (the source of truth) and then re-runs the
 * normal aggregator for each affected service date, so every derived table
 * lands consistently rather than three of them being patched by hand.
 */

export interface LineNameRepairResult {
  /** Aliases written to gtfs_route_aliases when the table was empty. */
  aliasesBackfilled: number;
  /** stale line name → what it was rewritten to, with the event count. */
  relabelled: { from: string; to: string; routeId: string; events: number }[];
  /** Service dates whose aggregates were recomputed. */
  serviceDatesRecomputed: string[];
}

/**
 * Rebuild `gtfs_route_aliases` from each version's archived `routes.txt`.
 *
 * Versions ingested before the alias table existed have no rows, but the raw
 * feed files were archived, so the mapping is recoverable. This covers *every*
 * version, not just the current one: replaying the archive resolves each
 * snapshot against the schedule effective at the time, so a historical version
 * without aliases makes the replay label real trips "Unknown line" — undoing
 * this very repair. A version whose `routes.txt` was never archived (the old
 * `import:gtfs` path did not store files) simply has nothing to recover.
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

  // Real line names, judged against every GTFS version ever ingested *and* the
  // reference catalog — not just the current version. NJT's feed changes shape
  // (Port Jervis is its own route in some feeds, folded into the Main Line in
  // others), so a line missing from today's feed is still a real line with real
  // history. Treating it as a stray route id would destroy that attribution.
  const realLineNames = new Set([
    ...repos.gtfs.knownLineNames(),
    ...RAIL_LINES.map((l) => l.name),
    UNKNOWN_LINE_NAME,
  ]);

  const relabelled: LineNameRepairResult["relabelled"] = [];
  const affectedDates = new Set<string>();

  // A route_id holding a *line name* is malformed whatever produced it: restore
  // the name to line_name and put the catalog's route id back in route_id.
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

    // Unresolvable ids become explicitly unknown; they keep their route_id so
    // the original feed value isn't lost.
    const target =
      canonicalRouteId && lineName ? { routeId: canonicalRouteId, lineName } : { routeId: stale, lineName: UNKNOWN_LINE_NAME };

    for (const date of repos.events.serviceDatesForLineName(stale)) affectedDates.add(date);
    const events = repos.events.relabelLineName(stale, target.routeId, target.lineName);
    relabelled.push({ from: stale, to: target.lineName, routeId: target.routeId, events });
  }

  // Days already rolled up from stale events. Without this the repair cannot
  // resume: relabelling commits per statement, so a run that dies during the
  // recompute leaves clean events and stranded aggregates, and a re-run finds
  // nothing to do while the site still serves the old names.
  for (const date of repos.aggregates.serviceDatesWithUnknownLineNames([...realLineNames])) {
    affectedDates.add(date);
  }

  const serviceDatesRecomputed = [...affectedDates].sort();
  for (const date of serviceDatesRecomputed) {
    recomputeServiceDate(repos, date);
    // Yield the write lock between days. Each recompute is its own transaction,
    // but running ~80 of them back-to-back starves the live pipeline, which
    // polls every 30s — and a poll that can't write is a lost observation.
    options?.betweenDates?.(date);
  }

  return { aliasesBackfilled, relabelled, serviceDatesRecomputed };
}
