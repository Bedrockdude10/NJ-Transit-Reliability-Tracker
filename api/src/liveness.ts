import type { FeedHealth } from "@njt/shared";

/**
 * A stalled ingest is a permanent hole — NJT serves no history to backfill from.
 * TripUpdates only: nothing is derived from VehiclePositions or ServiceAlerts.
 */

export const INGEST_FEED = "TripUpdates";

export interface Liveness {
  ok: boolean;
  feedType: string;
  lastSuccessAtMs: number | null;
  /** How long since the last successful fetch, or null if there has never been one. */
  staleForMs: number | null;
  thresholdMs: number;
  reason: string;
}

export function ingestLiveness(
  feeds: readonly FeedHealth[],
  nowMs: number,
  thresholdMs: number,
): Liveness {
  const feed = feeds.find((f) => f.feedType === INGEST_FEED);
  const base = { feedType: INGEST_FEED, thresholdMs };

  if (!feed || feed.lastSuccessAtMs === null) {
    // Never ingested. Brief on a first deploy, but treating it as healthy would
    // hide the worst version of this failure.
    return {
      ...base,
      ok: false,
      lastSuccessAtMs: null,
      staleForMs: null,
      reason: `no successful ${INGEST_FEED} fetch has ever been recorded`,
    };
  }

  const staleForMs = nowMs - feed.lastSuccessAtMs;
  // A clock that has gone backwards should not read as an outage.
  const ok = staleForMs <= thresholdMs;
  return {
    ...base,
    ok,
    lastSuccessAtMs: feed.lastSuccessAtMs,
    staleForMs,
    reason: ok
      ? `last ${INGEST_FEED} fetch ${Math.round(staleForMs / 1000)}s ago`
      : `no ${INGEST_FEED} fetch for ${Math.round(staleForMs / 60_000)} minutes`,
  };
}
