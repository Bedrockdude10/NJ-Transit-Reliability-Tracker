import type { AlertFrequencyResponse } from "@njt/shared";

/**
 * GTFS-RT alert `effect` is optional, and NJT never populates it — every alert
 * decodes to "unknown". A fixed list of effect filters therefore offered seven
 * chips that all matched nothing, and every alert wore an "Unknown" badge.
 *
 * These helpers drive the filter off what the data actually contains, so the
 * UI stays honest now and lights up on its own if NJT starts sending effects.
 */

/** Effect types that actually occur in the period, most frequent first. */
export function availableEffects(freq: AlertFrequencyResponse | null | undefined): string[] {
  if (!freq) return [];
  const totals = new Map<string, number>();
  for (const line of freq.byLine) {
    for (const [effect, count] of Object.entries(line.counts)) {
      if (!isMeaningfulEffect(effect)) continue;
      totals.set(effect, (totals.get(effect) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([effect]) => effect);
}

/** Whether an effect value carries information worth showing to a reader. */
export function isMeaningfulEffect(effect: string | null | undefined): boolean {
  return !!effect && effect !== "unknown";
}
