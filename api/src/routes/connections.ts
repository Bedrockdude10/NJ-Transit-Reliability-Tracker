import type { Repositories } from "@njt/db";
import {
  LOW_SAMPLE_THRESHOLD,
  type ConnectionDailyRow,
  type ConnectionDayOfWeekResult,
  type ConnectionRateResult,
  type ConnectionResponse,
  type ConnectionTopResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { buildDistributionResult, mergeCountMaps } from "../aggregation";
import { stopName } from "../catalog";
import { resolveRange } from "../dates";
import { badRequest, parseLimit, round1 } from "../util";

function rate(observations: number, successes: number): ConnectionRateResult {
  return {
    observations,
    successes,
    successRatePercent: observations > 0 ? round1((successes / observations) * 100) : 0,
  };
}

function buildResponse(
  inboundTripId: string,
  transferStopId: string,
  outboundTripId: string,
  from: string,
  to: string,
  rows: readonly ConnectionDailyRow[],
): ConnectionResponse {
  const sum = (pick: (r: ConnectionDailyRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const observations = sum((r) => r.observations);
  const successes = sum((r) => r.successes);

  const byDow = new Map<number, { observations: number; successes: number }>();
  for (const r of rows) {
    for (const [dowKey, value] of Object.entries(r.byDayOfWeek)) {
      const dow = Number(dowKey);
      const acc = byDow.get(dow) ?? { observations: 0, successes: 0 };
      acc.observations += value.observations;
      acc.successes += value.successes;
      byDow.set(dow, acc);
    }
  }
  const byDayOfWeek: ConnectionDayOfWeekResult[] = [...byDow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayOfWeek, v]) => ({ dayOfWeek, ...rate(v.observations, v.successes) }));

  const response: ConnectionResponse = {
    inboundTripId,
    transferStopId,
    outboundTripId,
    from,
    to,
    observations,
    successes,
    successRatePercent: observations > 0 ? round1((successes / observations) * 100) : 0,
    byDayOfWeek,
    peak: rate(sum((r) => r.peakObservations), sum((r) => r.peakSuccesses)),
    offPeak: rate(sum((r) => r.offPeakObservations), sum((r) => r.offPeakSuccesses)),
    inboundDelayDistribution: buildDistributionResult(mergeCountMaps(rows.map((r) => r.inboundDelayDistribution))),
    lowSample: observations < LOW_SAMPLE_THRESHOLD,
  };
  return response;
}

export function connectionRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const inbound = c.req.query("inbound_trip_id");
    const transfer = c.req.query("transfer_stop_id");
    const outbound = c.req.query("outbound_trip_id");
    if (!inbound || !transfer || !outbound) {
      badRequest("inbound_trip_id, transfer_stop_id, and outbound_trip_id are required");
    }
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const rows = repos.aggregates.getConnectionRows(inbound, transfer, outbound, range.from, range.to);
    return c.json(buildResponse(inbound, transfer, outbound, range.from, range.to, rows));
  });

  // Highest-frequency transfer triples, to auto-populate the UI picker.
  router.get("/top", (c) => {
    const limit = parseLimit(c.req.query("limit"), 10);
    const range = resolveRange(c.req.query("from"), c.req.query("to"));
    const response: ConnectionTopResponse = {
      transfers: repos.aggregates.topConnectionTriples(limit, range.from, range.to).map((t) => ({
        inboundTripId: t.inboundTripId,
        transferStopId: t.transferStopId,
        transferStopName: stopName(repos, t.transferStopId),
        outboundTripId: t.outboundTripId,
        observations: t.observations,
      })),
    };
    return c.json(response);
  });

  return router;
}
