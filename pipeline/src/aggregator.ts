import type { Repositories } from "@njt/db";
import {
  NJT_TIMEZONE,
  OTP_THRESHOLDS_SECONDS,
  PEAK_WINDOWS,
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

const ON_TIME_SECS = 300; // "within 5 minutes" for amplification arrival test

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
  for (const t of OTP_THRESHOLDS_SECONDS) counts[String(t)] = 0;
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
  const maxWindow = options.maxTransferWindowSeconds ?? 1800;
  const minBuffer = options.minTransferBufferSeconds ?? 0;
  const lateThreshold = options.lateThresholdSeconds ?? ON_TIME_SECS;

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
      for (const t of OTP_THRESHOLDS_SECONDS) if (isOnTime(delay, t)) acc.onTime[String(t)] = (acc.onTime[String(t)] ?? 0) + 1;
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

  // --- Per-trip rollups (OTP, distribution, heatmap, trip terminal delay) ----
  for (const [tripId, tripEvents] of groupByTrip(events)) {
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
  const station = computeStationAggregates(events, serviceDate, tz, lateThreshold);

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
      const hKey = `${e.stopId}|${localHourOfDay(at, tz)}`;
      const h = hourlyAcc.get(hKey) ?? { stopId: e.stopId, hour: localHourOfDay(at, tz), sum: 0, obs: 0 };
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
  for (const tripEvents of groupByTrip(events).values()) {
    for (let i = 0; i < tripEvents.length - 1; i++) {
      const cur = tripEvents[i];
      const next = tripEvents[i + 1];
      if (!cur || !next || cur.delaySeconds === null || cur.tripCancelled) continue;
      if (Math.abs(cur.delaySeconds) > ON_TIME_SECS) continue; // arrived on time only
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

  for (const [stopId, stopEvents] of byStop) {
    const arrivals = stopEvents.filter((e) => !e.tripCancelled && e.scheduledArrival !== null && e.observedArrival !== null);
    const departures = stopEvents.filter((e) => !e.tripCancelled && e.scheduledDeparture !== null);

    for (const inbound of arrivals) {
      const schedArr = inbound.scheduledArrival as number;
      const actualArr = inbound.observedArrival as number;
      for (const outbound of departures) {
        if (outbound.tripId === inbound.tripId) continue;
        const dep = outbound.scheduledDeparture as number;
        if (dep < schedArr || dep > schedArr + maxWindow) continue; // outside transfer window

        const key = `${inbound.tripId}|${stopId}|${outbound.tripId}`;
        const c =
          acc.get(key) ??
          { inboundTripId: inbound.tripId, transferStopId: stopId, outboundTripId: outbound.tripId, observations: 0, successes: 0, peakObs: 0, peakSucc: 0, offObs: 0, offSucc: 0, byDow: {}, dist: {} };

        const success = actualArr <= dep - minBuffer;
        const peak = isPeak(schedArr, PEAK_WINDOWS, tz);
        const dow = String(localDayOfWeek(schedArr, tz));
        const label = bucketForDelay(actualArr - schedArr).label;

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

  repos.aggregates.clearServiceDate(serviceDate);
  for (const row of bundle.otp) repos.aggregates.upsertOtpDaily(row);
  for (const row of bundle.distribution) repos.aggregates.upsertDelayDistributionDaily(row);
  for (const row of bundle.heatmap) repos.aggregates.upsertHeatmapDaily(row);
  for (const row of bundle.trips) repos.aggregates.upsertTripDaily(row);
  for (const row of bundle.stationDaily) repos.aggregates.upsertStationDaily(row);
  for (const row of bundle.stationHourly) repos.aggregates.upsertStationHourly(row);
  for (const row of bundle.stationDistribution) repos.aggregates.upsertStationDistributionDaily(row);
  for (const row of bundle.connections) repos.aggregates.upsertConnectionDaily(row);
}
