/** Aligns several lines' NJT monthly OTP onto a shared month axis. */

import type { LineMonthlyResponse } from "@njt/shared";

export interface ComparisonSeries {
  id: string;
  name: string;
  /** Hex, no leading `#`. */
  color: string | null;
  /** Aligned to `months`; null where that line published none. */
  values: (number | null)[];
  latestMonth: string | null;
  latestOtpPercent: number | null;
  avgOtpPercent: number | null;
}

export interface Comparison {
  /** Union of every selected line's published months, ascending. */
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
 * Carry the last known value forward so a sparse series draws as a continuous
 * line. For charts only — tables must show the raw `values`, with their gaps.
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
