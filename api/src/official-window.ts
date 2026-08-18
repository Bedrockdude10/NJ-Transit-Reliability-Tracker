import { monthLabel, type PublishedCoverage, type YearMonth } from "@njt/shared";
import type { MonthRange } from "./dates";

/**
 * Official NJT figures are monthly and published in arrears, so the default
 * trailing-30-day window usually contains no published month. Fall back to the
 * newest month that exists and report the substitution in `coverage`.
 */
export interface ResolvedOfficialWindow<T> {
  metrics: T[];
  /** Null only when nothing has ever been published for this scope. */
  coverage: PublishedCoverage | null;
}

export function resolveOfficialWindow<T extends YearMonth>(
  requested: MonthRange,
  fetch: (from: YearMonth, to: YearMonth) => T[],
  latest: () => YearMonth | null,
): ResolvedOfficialWindow<T> {
  const inRange = fetch(requested.from, requested.to);
  if (inRange.length > 0) return { metrics: inRange, coverage: coverageOf(inRange, false) };

  const latestMonth = latest();
  if (!latestMonth) return { metrics: [], coverage: null };

  const fallback = fetch(latestMonth, latestMonth);
  if (fallback.length === 0) return { metrics: [], coverage: null };
  return { metrics: fallback, coverage: coverageOf(fallback, true) };
}

function coverageOf(metrics: readonly YearMonth[], outsideRequestedRange: boolean): PublishedCoverage {
  let min = metrics[0]!;
  let max = metrics[0]!;
  for (const m of metrics) {
    if (m.year * 12 + m.month < min.year * 12 + min.month) min = m;
    if (m.year * 12 + m.month > max.year * 12 + max.month) max = m;
  }
  return {
    fromMonth: monthLabel(min.year, min.month),
    toMonth: monthLabel(max.year, max.month),
    outsideRequestedRange,
  };
}
