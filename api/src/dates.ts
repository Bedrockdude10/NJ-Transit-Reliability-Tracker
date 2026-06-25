import { addDays, parseDateString, toLocalDateString } from "@njt/shared";
import { badRequest } from "./util";

export interface DateRange {
  from: string;
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) badRequest(`${label} must be YYYY-MM-DD, got "${value}"`);
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

/** The inclusive month range covering a date range, for official-metric joins. */
export function monthRange(range: DateRange): MonthRange {
  const f = parseDateString(range.from);
  const t = parseDateString(range.to);
  return { from: { year: f.year, month: f.month }, to: { year: t.year, month: t.month } };
}
