import type { Repositories } from "@njt/db";
import {
  NJT_TIMEZONE,
  OTP_STRICT_THRESHOLD_SECONDS,
  OTP_THRESHOLDS_SECONDS,
  PEAK_WINDOWS,
  TRANSFER_BUFFER_DEFAULT_SECONDS,
  TRANSFER_WINDOW_DEFAULT_SECONDS,
  bucketForDelay,
  isOnTime,
  isPeak,
  localDayOfWeek,
  localHourOfDay,
  type ConnectionDailyRow,
  type DelayDistributionDailyRow,
  type Direction,
  type HeatmapDailyRow,
  type OtpDailyRow,
  type ScopeKind,
  type StationDailyRow,
  type StationDistributionDailyRow,
  type StationHourlyRow,
  type TripDailyRow,
  type TripStopEvent,
} from "@njt/shared";

export interface AggregatorOptions {
  timeZone?: string;
  /** Outbound must depart within this many seconds of the inbound's scheduled arrival to be a candidate connection. */
  maxTransferWindowSeconds?: number;
  /** Required slack (seconds) between inbound actual arrival and outbound departure. */
  minTransferBufferSeconds?: number;
  /** Delay (seconds) above which a stop counts as "departed late" for amplification. */
  lateThresholdSeconds?: number;
}

export interface AggregateBundle {
  otp: OtpDailyRow[];
  distribution: DelayDistributionDailyRow[];
  heatmap: HeatmapDailyRow[];
  trips: TripDailyRow[];
  stationDaily: StationDailyRow[];
  stationHourly: StationHourlyRow[];
  stationDistribution: StationDistributionDailyRow[];
  connections: ConnectionDailyRow[];
}

// Precomputed once: the on-time thresholds paired with their JSON string keys,
// so the per-event OtpAcc loop never rebuilds `String(t)` (mirrors the
// countOnTimeByThreshold pattern in shared/src/delay.ts).
const THRESHOLD_KEYS: readonly (readonly [number, string])[] = OTP_THRESHOLDS_SECONDS.map(
  (t) => [t, String(t)] as const,
);

interface OtpAcc {
  scope: ScopeKind;
  scopeId: string;
  direction: "all" | Direction;
  operated: number;
  cancelled: number;
  onTime: Record<string, number>;
  sumDelay: number;
}

function emptyOnTime(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [, key] of THRESHOLD_KEYS) counts[key] = 0;
  return counts;
}

/** Group a service date's events by trip, each ordered by stop sequence. */
function groupByTrip(events: readonly TripStopEvent[]): Map<string, TripStopEvent[]> {
  const byTrip = new Map<string, TripStopEvent[]>();
  for (const e of events) {
    const list = byTrip.get(e.tripId) ?? [];
    list.push(e);
    byTrip.set(e.tripId, list);
  }
  for (const list of byTrip.values()) list.sort((a, b) => a.stopSequence - b.stopSequence);
  return byTrip;
}

/**
 * Compute all daily aggregate rows for one service date from its raw events.
 * Pure: takes events, returns rows. The persistence wrapper writes them.
 */
export function computeAggregates(
  events: readonly TripStopEvent[],
  serviceDate: string,
  options: AggregatorOptions = {},
): AggregateBundle {
  const tz = options.timeZone ?? NJT_TIMEZONE;
  const maxWindow = options.maxTransferWindowSeconds ?? TRANSFER_WINDOW_DEFAULT_SECONDS;
  const minBuffer = options.minTransferBufferSeconds ?? TRANSFER_BUFFER_DEFAULT_SECONDS;
  const lateThreshold = options.lateThresholdSeconds ?? OTP_STRICT_THRESHOLD_SECONDS;

  const otpAcc = new Map<string, OtpAcc>();
  const distAcc = new Map<string, Record<string, number>>(); // scope|scopeId -> counts
  const heatAcc = new Map<string, { scope: ScopeKind; scopeId: string; type: "hour_of_day" | "day_of_week"; bucket: number; sum: number; obs: number }>();
  const trips: TripDailyRow[] = [];

  const addOtp = (scope: ScopeKind, scopeId: string, direction: "all" | Direction, cancelled: boolean, delay: number | null) => {
    const key = `${scope}|${scopeId}|${direction}`;
    const acc = otpAcc.get(key) ?? { scope, scopeId, direction, operated: 0, cancelled: 0, onTime: emptyOnTime(), sumDelay: 0 };
    if (cancelled) {
      acc.cancelled += 1;
    } else if (delay !== null) {
      acc.operated += 1;
      acc.sumDelay += delay;
      for (const [t, tKey] of THRESHOLD_KEYS) {
        // onTime is pre-seeded by emptyOnTime(), so every threshold key exists.
        if (isOnTime(delay, t)) acc.onTime[tKey] = acc.onTime[tKey]! + 1;
      }
    }
    otpAcc.set(key, acc);
  };

  const addDist = (scope: ScopeKind, scopeId: string, delay: number) => {
    const key = `${scope}|${scopeId}`;
    const counts = distAcc.get(key) ?? {};
    const label = bucketForDelay(delay).label;
    counts[label] = (counts[label] ?? 0) + 1;
    distAcc.set(key, counts);
  };

  const addHeat = (scope: ScopeKind, scopeId: string, atSeconds: number, delay: number) => {
    for (const [type, bucket] of [
      ["hour_of_day", localHourOfDay(atSeconds, tz)],
      ["day_of_week", localDayOfWeek(atSeconds, tz)],
    ] as const) {
      const key = `${scope}|${scopeId}|${type}|${bucket}`;
      const acc = heatAcc.get(key) ?? { scope, scopeId, type, bucket, sum: 0, obs: 0 };
      acc.sum += delay;
      acc.obs += 1;
      heatAcc.set(key, acc);
    }
  };

  // Group once; reused by the per-trip rollups and station amplification.
  const byTrip = groupByTrip(events);

  // --- Per-trip rollups (OTP, distribution, heatmap, trip terminal delay) ----
  for (const [tripId, tripEvents] of byTrip) {
    const terminal = tripEvents[tripEvents.length - 1];
    if (!terminal) continue;
    const cancelled = tripEvents.some((e) => e.tripCancelled);
    const { routeId, lineName, direction } = terminal;
    const terminalDelay = cancelled ? null : terminal.delaySeconds;

    addOtp("system", "system", "all", cancelled, terminalDelay);
    addOtp("line", routeId, "all", cancelled, terminalDelay);
    addOtp("line", routeId, direction, cancelled, terminalDelay);

    if (!cancelled && terminalDelay !== null) {
      addDist("system", "system", terminalDelay);
      addDist("line", routeId, terminalDelay);
      const at = terminal.scheduledArrival ?? terminal.observedArrival;
      if (at !== null) {
        addHeat("system", "system", at, terminalDelay);
        addHeat("line", routeId, at, terminalDelay);
      }
    }

    trips.push({
      tripId,
      serviceDate,
      routeId,
      lineName,
      direction,
      terminalStopName: terminal.stopName,
      terminalDelaySeconds: terminalDelay,
    });
  }

  // --- Station rollups (per stop) + amplification (consecutive stops) --------
  const station = computeStationAggregates(events, byTrip, serviceDate, tz, lateThreshold);

  // --- Connections -----------------------------------------------------------
  const connections = computeConnections(events, serviceDate, tz, maxWindow, minBuffer);

  return {
    otp: [...otpAcc.values()].map((a) => ({
      scope: a.scope,
      scopeId: a.scopeId,
      serviceDate,
      direction: a.direction,
      tripsOperated: a.operated,
      tripsCancelled: a.cancelled,
      onTimeCounts: a.onTime,
      sumDelaySeconds: a.sumDelay,
    })),
    distribution: [...distAcc.entries()].map(([key, counts]) => {
      const [scope, scopeId] = key.split("|") as [ScopeKind, string];
      return { scope, scopeId, serviceDate, counts };
    }),
    heatmap: [...heatAcc.values()].map((a) => ({
      scope: a.scope,
      scopeId: a.scopeId,
      type: a.type,
      bucket: a.bucket,
      serviceDate,
      sumDelaySeconds: a.sum,
      observations: a.obs,
    })),
    trips,
    ...station,
    connections,
  };
}

function computeStationAggregates(
  events: readonly TripStopEvent[],
  byTrip: Map<string, TripStopEvent[]>,
  serviceDate: string,
  tz: string,
  lateThreshold: number,
): Pick<AggregateBundle, "stationDaily" | "stationHourly" | "stationDistribution"> {
  interface StationAcc {
    stopId: string;
    lineName: string;
    direction: Direction;
    sum: number;
    obs: number;
    within5: number;
    departedLate: number;
  }
  const dailyAcc = new Map<string, StationAcc>();
  const hourlyAcc = new Map<string, { stopId: string; hour: number; sum: number; obs: number }>();
  const distAcc = new Map<string, Record<string, number>>();

  // Arrival-based stats over every event with a known delay.
  for (const e of events) {
    if (e.delaySeconds === null || e.tripCancelled) continue;
    const dKey = `${e.stopId}|${e.lineName}|${e.direction}`;
    const acc = dailyAcc.get(dKey) ?? { stopId: e.stopId, lineName: e.lineName, direction: e.direction, sum: 0, obs: 0, within5: 0, departedLate: 0 };
    acc.sum += e.delaySeconds;
    acc.obs += 1;
    dailyAcc.set(dKey, acc);

    const at = e.scheduledArrival ?? e.observedArrival;
    if (at !== null) {
      const hour = localHourOfDay(at, tz);
      const hKey = `${e.stopId}|${hour}`;
      const h = hourlyAcc.get(hKey) ?? { stopId: e.stopId, hour, sum: 0, obs: 0 };
      h.sum += e.delaySeconds;
      h.obs += 1;
      hourlyAcc.set(hKey, h);
    }

    const counts = distAcc.get(e.stopId) ?? {};
    const label = bucketForDelay(e.delaySeconds).label;
    counts[label] = (counts[label] ?? 0) + 1;
    distAcc.set(e.stopId, counts);
  }

  // Amplification: arrived within 5 min here, then late at the next stop.
  for (const tripEvents of byTrip.values()) {
    for (let i = 0; i < tripEvents.length - 1; i++) {
      const cur = tripEvents[i];
      const next = tripEvents[i + 1];
      if (!cur || !next || cur.delaySeconds === null || cur.tripCancelled) continue;
      if (Math.abs(cur.delaySeconds) > OTP_STRICT_THRESHOLD_SECONDS) continue; // arrived on time only
      const acc = dailyAcc.get(`${cur.stopId}|${cur.lineName}|${cur.direction}`);
      if (!acc) continue;
      acc.within5 += 1;
      if (next.delaySeconds !== null && next.delaySeconds > lateThreshold) acc.departedLate += 1;
    }
  }

  return {
    stationDaily: [...dailyAcc.values()].map((a) => ({
      stopId: a.stopId,
      serviceDate,
      lineName: a.lineName,
      direction: a.direction,
      sumArrivalDelaySeconds: a.sum,
      observations: a.obs,
      arrivedWithin5Min: a.within5,
      departedLateAfterOnTimeArrival: a.departedLate,
    })),
    stationHourly: [...hourlyAcc.values()].map((a) => ({
      stopId: a.stopId,
      serviceDate,
      hour: a.hour,
      sumDelaySeconds: a.sum,
      observations: a.obs,
    })),
    stationDistribution: [...distAcc.entries()].map(([stopId, counts]) => ({ stopId, serviceDate, counts })),
  };
}

function computeConnections(
  events: readonly TripStopEvent[],
  serviceDate: string,
  tz: string,
  maxWindow: number,
  minBuffer: number,
): ConnectionDailyRow[] {
  // Group events by transfer stop.
  const byStop = new Map<string, TripStopEvent[]>();
  for (const e of events) {
    const list = byStop.get(e.stopId) ?? [];
    list.push(e);
    byStop.set(e.stopId, list);
  }

  interface ConnAcc {
    inboundTripId: string;
    transferStopId: string;
    outboundTripId: string;
    observations: number;
    successes: number;
    peakObs: number;
    peakSucc: number;
    offObs: number;
    offSucc: number;
    byDow: Record<string, { observations: number; successes: number }>;
    dist: Record<string, number>;
  }
  const acc = new Map<string, ConnAcc>();

  // Narrowed views so the sweep works on non-null times without `as number`.
  interface Arrival {
    tripId: string;
    scheduledArrival: number;
    observedArrival: number;
  }
  interface Departure {
    tripId: string;
    scheduledDeparture: number;
  }

  for (const [stopId, stopEvents] of byStop) {
    const arrivals: Arrival[] = [];
    const departures: Departure[] = [];
    for (const e of stopEvents) {
      if (e.tripCancelled) continue;
      if (e.scheduledArrival !== null && e.observedArrival !== null) {
        arrivals.push({ tripId: e.tripId, scheduledArrival: e.scheduledArrival, observedArrival: e.observedArrival });
      }
      if (e.scheduledDeparture !== null) {
        departures.push({ tripId: e.tripId, scheduledDeparture: e.scheduledDeparture });
      }
    }
    // Sort once, then sweep a two-pointer window [schedArr, schedArr + maxWindow]
    // over the departures for each arrival (arrivals ascending ⇒ window start
    // only ever advances). Replaces the old O(arrivals × departures) loop.
    arrivals.sort((a, b) => a.scheduledArrival - b.scheduledArrival);
    departures.sort((a, b) => a.scheduledDeparture - b.scheduledDeparture);

    let lo = 0;
    for (const inbound of arrivals) {
      const schedArr = inbound.scheduledArrival;
      const actualArr = inbound.observedArrival;
      // These depend only on the inbound arrival, so compute them once per
      // arrival rather than per candidate outbound (O(arrivals), not O(pairs)).
      const peak = isPeak(schedArr, PEAK_WINDOWS, tz);
      const dow = String(localDayOfWeek(schedArr, tz));
      const label = bucketForDelay(actualArr - schedArr).label;
      while (lo < departures.length) {
        const d = departures[lo];
        if (!d || d.scheduledDeparture >= schedArr) break;
        lo++;
      }
      for (let j = lo; j < departures.length; j++) {
        const outbound = departures[j];
        if (!outbound) break;
        const dep = outbound.scheduledDeparture;
        if (dep > schedArr + maxWindow) break; // past the window; later deps are too
        if (outbound.tripId === inbound.tripId) continue;

        const key = `${inbound.tripId}|${stopId}|${outbound.tripId}`;
        const c =
          acc.get(key) ??
          { inboundTripId: inbound.tripId, transferStopId: stopId, outboundTripId: outbound.tripId, observations: 0, successes: 0, peakObs: 0, peakSucc: 0, offObs: 0, offSucc: 0, byDow: {}, dist: {} };

        const success = actualArr <= dep - minBuffer;

        c.observations += 1;
        if (success) c.successes += 1;
        if (peak) {
          c.peakObs += 1;
          if (success) c.peakSucc += 1;
        } else {
          c.offObs += 1;
          if (success) c.offSucc += 1;
        }
        const dowAcc = c.byDow[dow] ?? { observations: 0, successes: 0 };
        dowAcc.observations += 1;
        if (success) dowAcc.successes += 1;
        c.byDow[dow] = dowAcc;
        c.dist[label] = (c.dist[label] ?? 0) + 1;

        acc.set(key, c);
      }
    }
  }

  return [...acc.values()].map((c) => ({
    inboundTripId: c.inboundTripId,
    transferStopId: c.transferStopId,
    outboundTripId: c.outboundTripId,
    serviceDate,
    observations: c.observations,
    successes: c.successes,
    peakObservations: c.peakObs,
    peakSuccesses: c.peakSucc,
    offPeakObservations: c.offObs,
    offPeakSuccesses: c.offSucc,
    byDayOfWeek: c.byDow,
    inboundDelayDistribution: c.dist,
  }));
}

/** Recompute and persist all aggregates for a service date (idempotent). */
export function recomputeServiceDate(repos: Repositories, serviceDate: string, options?: AggregatorOptions): void {
  const events = repos.events.getByServiceDate(serviceDate);
  const bundle = computeAggregates(events, serviceDate, options);

  // One atomic clear+upsert so API readers never see a half-cleared day and a
  // failed recompute rolls back cleanly (persistence lives in @njt/db).
  repos.aggregates.replaceServiceDate(serviceDate, bundle);
}
