import type { ObservedJourney } from "@njt/db";
import {
  LOW_SAMPLE_THRESHOLD,
  OTP_STRICT_THRESHOLD_SECONDS,
  getLocalParts,
  type CommuteDeparture,
} from "@njt/shared";
import { round1 } from "./util";

/**
 * Turn observed journeys between two stops into the answer riders actually
 * want: not "how is the line doing?" but "how does *my* train do?".
 *
 * Reliability is judged at the destination, because that is where lateness is
 * felt — a train that leaves on time and arrives twenty minutes late is not a
 * punctual train. Departures are grouped by their timetabled slot rather than
 * by trip id, since the trip id changes across schedule revisions while "the
 * 7:42" is the thing a commuter actually plans around.
 */

/** Exact percentile of raw values (unlike the bucketed estimate used elsewhere). */
export function percentileOf(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: with few observations, interpolating invents precision.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] ?? null;
}

export function medianOf(values: readonly number[]): number | null {
  return percentileOf(values, 50);
}

/** Minutes after local midnight for an instant, for grouping by timetable slot. */
export function departureMinutes(epochSeconds: number): number {
  const { hour, minute } = getLocalParts(epochSeconds);
  return hour * 60 + minute;
}

export function formatDepartureLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

interface Group {
  departureMinutes: number;
  lineName: string;
  scheduledMinutes: number | null;
  delays: number[];
  observations: number;
  cancellations: number;
}

/** Journeys that completed — the only ones with a delay to measure. */
function isMeasurable(j: ObservedJourney): boolean {
  return !j.cancelled && !j.skipped && j.destinationDelaySeconds !== null;
}

export function buildCommuteDepartures(journeys: readonly ObservedJourney[]): CommuteDeparture[] {
  const groups = new Map<number, Group>();

  for (const j of journeys) {
    if (j.scheduledDeparture === null) continue;
    const key = departureMinutes(j.scheduledDeparture);
    const scheduledMinutes =
      j.scheduledArrival !== null && j.scheduledDeparture !== null
        ? Math.round((j.scheduledArrival - j.scheduledDeparture) / 60)
        : null;

    const g =
      groups.get(key) ??
      ({ departureMinutes: key, lineName: j.lineName, scheduledMinutes, delays: [], observations: 0, cancellations: 0 } as Group);

    // A cancellation is an observation of the departure, just not of a delay.
    g.observations += 1;
    if (j.cancelled) g.cancellations += 1;
    else if (isMeasurable(j)) g.delays.push(j.destinationDelaySeconds as number);
    if (g.scheduledMinutes === null) g.scheduledMinutes = scheduledMinutes;
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g): CommuteDeparture => {
      const onTime = g.delays.filter((d) => d <= OTP_STRICT_THRESHOLD_SECONDS).length;
      const lowSample = g.delays.length < LOW_SAMPLE_THRESHOLD;
      return {
        departureMinutes: g.departureMinutes,
        label: formatDepartureLabel(g.departureMinutes),
        lineName: g.lineName,
        scheduledMinutes: g.scheduledMinutes,
        observations: g.observations,
        cancellations: g.cancellations,
        // Withhold a rate rather than publish one from a handful of runs.
        onTimePercent: g.delays.length > 0 ? round1((onTime / g.delays.length) * 100) : null,
        avgArrivalDelaySeconds:
          g.delays.length > 0 ? round1(g.delays.reduce((s, d) => s + d, 0) / g.delays.length) : null,
        p90ArrivalDelaySeconds: percentileOf(g.delays, 90),
        lowSample,
      };
    })
    .sort((a, b) => a.departureMinutes - b.departureMinutes);
}

/**
 * Rank only departures with enough observations to mean something. Naming a
 * "most reliable" train off three runs would be worse than naming none.
 */
export function rankDepartures(departures: readonly CommuteDeparture[]): {
  mostReliable: CommuteDeparture | null;
  leastReliable: CommuteDeparture | null;
} {
  const rankable = departures.filter((d) => !d.lowSample && d.onTimePercent !== null);
  if (rankable.length < 2) return { mostReliable: null, leastReliable: null };
  const sorted = [...rankable].sort((a, b) => (b.onTimePercent as number) - (a.onTimePercent as number));
  return { mostReliable: sorted[0] ?? null, leastReliable: sorted[sorted.length - 1] ?? null };
}
