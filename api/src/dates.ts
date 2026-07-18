import { addDays, parseDateString, toLocalDateString } from "@njt/shared";
import { badRequest } from "./util";

export interface DateRange {
  from: string;
  to: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in a (1-12) month of a given year, accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateDate(value: string, label: string): string {
  const m = DATE_RE.exec(value);
  if (!m) badRequest(`${label} must be YYYY-MM-DD, got "${value}"`);
  const year = Number(m![1]);
  const month = Number(m![2]);
  const day = Number(m![3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    badRequest(`${label} must be a real calendar date, got "${value}"`);
  }
  return value;
}

/**
 * Resolve `from`/`to` query params. Both default to a trailing 30-day window
 * ending "today" in NJT local time (PRD: "default to last 30 days").
 */
export function resolveRange(fromParam?: string, toParam?: string, nowMs: number = Date.now()): DateRange {
  const today = toLocalDateString(Math.floor(nowMs / 1000));
  const to = toParam ? validateDate(toParam, "to") : today;
  const from = fromParam ? validateDate(fromParam, "from") : addDays(to, -29);
  if (from > to) badRequest(`"from" (${from}) must not be after "to" (${to})`);
  return { from, to };
}

export interface MonthRange {
  from: { year: number; month: number };
  to: { year: number; month: number };
}

/** Inclusive month bounds wide enough to cover all published history. */
export const ALL_MONTHS: MonthRange = { from: { year: 2000, month: 1 }, to: { year: 2100, month: 12 } };

/** The inclusive month range covering a date range, for official-metric joins. */
export function monthRange(range: DateRange): MonthRange {
  const f = parseDateString(range.from);
  const t = parseDateString(range.to);
  return { from: { year: f.year, month: f.month }, to: { year: t.year, month: t.month } };
}
