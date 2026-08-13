import type { Repositories } from "@njt/db";
import { recomputeServiceDate } from "../aggregator";

/**
 * Remove the fabricated measurement left behind by the pre-API seed.
 *
 * The seed predates the live feed: it invented trips so the dashboard had
 * something to draw before ingest existed. The seeding *code* is long gone, but
 * its output was never deleted from deployed databases, so the site kept
 * presenting fabricated trips as measurement and dated its own collection
 * history from them.
 *
 * This is deliberately narrower than `deploy/purge-synthetic.mjs`, which clears
 * `trip_stop_events` wholesale — correct when everything was synthetic, ruinous
 * now that real observations share the table. Here only rows matching the seed's
 * trip-id shape are removed, every affected day is recomputed from whatever
 * genuinely remains, and the collection window is re-anchored to the first real
 * observation so uptime stops being measured against invented history.
 */

export interface SeedPurgeResult {
  eventsDeleted: number;
  /** Days recomputed from the surviving events. */
  serviceDatesRecomputed: string[];
  collectionStartBefore: string | null;
  collectionStartAfter: string | null;
  /** Gaps dropped because they fell wholly before the new collection window. */
  gapsDropped: number;
  /** True when nothing was written — the report is a preview. */
  dryRun: boolean;
}

export interface SeedPurgeOptions {
  /** Report what would change without writing. */
  dryRun?: boolean;
  /** Called after each day's recompute, to yield the write lock. */
  betweenDates?: (serviceDate: string) => void;
}

/** Local midnight-UTC instant for a `YYYY-MM-DD` service date. */
function startOfDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function purgeSeedData(repos: Repositories, options: SeedPurgeOptions = {}): SeedPurgeResult {
  const dryRun = options.dryRun ?? false;
  const collectionStartBefore = repos.health.collectionStartDate();
  const serviceDates = repos.events.serviceDatesWithSeedEvents();
  const eventsDeleted = repos.events.countSeedEvents();

  if (eventsDeleted === 0) {
    return {
      eventsDeleted: 0,
      serviceDatesRecomputed: [],
      collectionStartBefore,
      collectionStartAfter: collectionStartBefore,
      gapsDropped: 0,
      dryRun,
    };
  }

  if (dryRun) {
    // Predict the new anchor without touching anything: the earliest date that
    // isn't wholly seeded. Dates never mix seed and real rows in practice, but
    // computing it this way stays correct if they ever do.
    const seeded = new Set(serviceDates);
    const remaining = repos.events
      .serviceDates()
      .filter((d) => !seeded.has(d) || repos.events.getByServiceDate(d).some((e) => !isSeedTripId(e.tripId)));
    return {
      eventsDeleted,
      serviceDatesRecomputed: serviceDates,
      collectionStartBefore,
      collectionStartAfter: remaining[0] ?? null,
      gapsDropped: 0,
      dryRun: true,
    };
  }

  repos.events.deleteSeedEvents();

  // Rebuild each affected day from what survives. A day left with no events
  // recomputes to an empty bundle, which clears its rollups.
  for (const date of serviceDates) {
    recomputeServiceDate(repos, date);
    options.betweenDates?.(date);
  }

  // Re-anchor the collection window to the first surviving observation.
  const collectionStartAfter = repos.events.earliestServiceDate();
  if (collectionStartAfter) repos.health.setMeta("collection_start_date", collectionStartAfter);

  // Gaps entirely before the new window aren't lost coverage any more.
  const gapsDropped = collectionStartAfter
    ? repos.health.deleteGapsEndingAtOrBefore(startOfDayMs(collectionStartAfter))
    : 0;

  return { eventsDeleted, serviceDatesRecomputed: serviceDates, collectionStartBefore, collectionStartAfter, gapsDropped, dryRun: false };
}

/** Mirror of the repository's seed predicate, for the dry-run preview. */
function isSeedTripId(tripId: string): boolean {
  return /-inbound-|-outbound-/.test(tripId);
}
