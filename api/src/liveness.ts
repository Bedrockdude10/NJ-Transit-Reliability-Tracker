import type { FeedHealth } from "@njt/shared";

/**
 * Whether ingest is still running, as a status code an uptime monitor can see.
 *
 * `/health` answers 200 whenever the API process is up and the database is
 * readable, which is a narrower claim than it looks. The two processes are
 * supervised separately and — deliberately, since this is what stopped two
 * pipeline crashes from becoming total outages — the API survives the pipeline
 * dying. So the site can be up, serving a dashboard that quietly stops advancing,
 * and every external check stays green.
 *
 * That is the gap this closes. A stalled feed is the failure this project
 * actually has: an ingest that stops is a permanent hole, because NJT serves no
 * history to backfill from, and the cost of noticing a day late is a day of data
 * that no longer exists.
 *
 * TripUpdates only. VehiclePositions and ServiceAlerts are useful but nothing is
 * derived from them; TripUpdates is where every measurement comes from, and
 * alerting on feeds that do not matter is how alerts stop being read.
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
    // A machine that has never ingested. On a genuinely first deploy this is
    // expected and brief; if it persists it is exactly what needs reporting,
    // and treating "never" as healthy would hide the worst version of this.
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
