/**
 * Month primitives shared across packages. Official/light-rail metrics are keyed
 * by (year, month); these are the SSOT for encoding a month as a single
 * comparable integer and for the `${year}-${month}` string key.
 */

/** A calendar month. `month` is 1-12. */
export interface YearMonth {
  year: number;
  month: number;
}

/** `YYYY-MM` — the zero-padded form used in API responses. */
export function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * A month encoded as a single comparable integer (`year * 12 + (month - 1)`).
 * Monotonic in calendar order, so month ranges compare with plain `<=`/`>=`.
 */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** `${year}-${month}` key (month is 1-12, unpadded). */
export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}
