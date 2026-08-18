/** `month` is 1-12. */
export interface YearMonth {
  year: number;
  month: number;
}

/** `YYYY-MM`, zero-padded — the form used in API responses. */
export function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Monotonic in calendar order, so month ranges compare with plain `<=`/`>=`. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** `${year}-${month}` key (month is 1-12, unpadded). */
export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}
