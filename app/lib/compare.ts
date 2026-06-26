/**
 * Pure logic for the line comparison view. Aligns several lines' real NJT
 * monthly OTP onto a shared month axis so they can be charted and tabulated
 * side by side. No React Native imports — unit-tested directly.
 */

import type { LineMonthlyResponse } from "@njt/shared";

export interface ComparisonSeries {
  id: string;
  name: string;
  /** NJT route color (hex, no leading #), or null. */
  color: string | null;
  /** NJT 6-min OTP aligned to `months`; null where that line published none. */
  values: (number | null)[];
  latestMonth: string | null;
  latestOtpPercent: number | null;
  /** Mean of the line's published OTP over the shared range (null if none). */
  avgOtpPercent: number | null;
}

export interface Comparison {
  /** Union of every selected line's published months, ascending (`YYYY-MM`). */
  months: string[];
  series: ComparisonSeries[];
}

export interface CompareInput {
  id: string;
  name: string;
  color: string | null;
  monthly: LineMonthlyResponse;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** Build the aligned month axis + per-line series from each line's monthly rows. */
export function buildComparison(inputs: readonly CompareInput[]): Comparison {
  const monthSet = new Set<string>();
  for (const input of inputs) {
    for (const row of input.monthly.rows) {
      if (row.njtOtpPercent !== null) monthSet.add(row.month);
    }
  }
  const months = [...monthSet].sort();

  const series = inputs.map((input): ComparisonSeries => {
    const byMonth = new Map<string, number>();
    for (const row of input.monthly.rows) {
      if (row.njtOtpPercent !== null) byMonth.set(row.month, row.njtOtpPercent);
    }
    const values = months.map((m) => byMonth.get(m) ?? null);
    const present = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
    const latest = present.at(-1) ?? null;
    return {
      id: input.id,
      name: input.name,
      color: input.color,
      values,
      latestMonth: latest?.[0] ?? null,
      latestOtpPercent: latest?.[1] ?? null,
      avgOtpPercent: mean(present.map(([, v]) => v)),
    };
  });

  return { months, series };
}

/**
 * Replace nulls with the last known value (and lead with the first known) so a
 * sparse series can be drawn as a continuous line. Returns [] if all null.
 * Charts use this; tables should show the raw `values` (with their gaps).
 */
export function fillForward(values: readonly (number | null)[]): number[] {
  const firstKnown = values.find((v) => v !== null);
  if (firstKnown === undefined || firstKnown === null) return [];
  const out: number[] = [];
  let last = firstKnown;
  for (const v of values) {
    if (v !== null) last = v;
    out.push(last);
  }
  return out;
}
