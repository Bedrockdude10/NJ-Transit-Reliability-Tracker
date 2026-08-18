import type { AlertFrequencyResponse } from "@njt/shared";

/**
 * GTFS-RT alert `effect` is optional and NJT never populates it — every alert
 * decodes to "unknown". So the filter is driven off what the data contains, and
 * lights up on its own if NJT ever starts sending effects.
 */

/** Most frequent first. */
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

export function isMeaningfulEffect(effect: string | null | undefined): boolean {
  return !!effect && effect !== "unknown";
}
