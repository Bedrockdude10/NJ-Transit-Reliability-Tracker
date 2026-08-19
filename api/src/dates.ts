import { addDays, parseDateString, toLocalDateString } from "@njt/shared";
import { badRequest } from "./util";

export interface DateRange {
  from: string;
  to: string;
}

const DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateDate(value: string, label: string): string {
  const m = DATE_RE.exec(value);
  if (!m) badRequest(`${label} must be YYYY-MM-DD, got "${value}"`);
  const year = Number(m.groups?.year);
  const month = Number(m.groups?.month);
  const day = Number(m.groups?.day);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    badRequest(`${label} must be a real calendar date, got "${value}"`);
  }
  return value;
}

/** Defaults to a trailing 30 days ending today, NJT-local (PRD: "last 30 days"). */
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

/** Deliberately absurd bounds: wide enough to cover all published history. */
export const ALL_MONTHS: MonthRange = { from: { year: 2000, month: 1 }, to: { year: 2100, month: 12 } };

export function monthRange(range: DateRange): MonthRange {
  const f = parseDateString(range.from);
  const t = parseDateString(range.to);
  return { from: { year: f.year, month: f.month }, to: { year: t.year, month: t.month } };
}
