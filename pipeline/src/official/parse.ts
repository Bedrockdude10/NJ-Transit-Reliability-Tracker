import type { Repositories } from "@njt/db";
import type { OfficialNjtMetric } from "@njt/shared";
import { parseCsv } from "../csv";

/** Lower-cased header aliases -> our field. NJT's column names vary by export. */
const ALIASES = {
  year: ["year", "yr"],
  month: ["month", "mo", "month_num"],
  line: ["line", "line_name", "rail_line", "route"],
  otp: ["otp", "otp_percent", "on_time_percent", "on_time_performance", "on-time performance"],
  otpAdjusted: ["otp_amtrak_adjusted", "amtrak_adjusted_otp", "otp_adjusted", "adjusted_otp"],
  trips: ["trips", "trips_operated", "total_trips", "scheduled_trips"],
  cancellations: ["cancellations", "cancelled", "cancellation_count", "trips_cancelled", "canceled"],
} as const;

function normalizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) out[key.toLowerCase().trim()] = value;
  return out;
}

function pick(row: Record<string, string>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  return undefined;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/[%,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse NJT's monthly performance CSV into {@link OfficialNjtMetric}s. Rows
 * missing year/month/line or OTP are skipped rather than producing partial
 * records.
 */
export function parseOfficialMetrics(csv: string): OfficialNjtMetric[] {
  const metrics: OfficialNjtMetric[] = [];
  for (const raw of parseCsv(csv)) {
    const row = normalizeRow(raw);
    const year = toNumber(pick(row, ALIASES.year));
    const month = toNumber(pick(row, ALIASES.month));
    const line = pick(row, ALIASES.line);
    const otp = toNumber(pick(row, ALIASES.otp));
    if (year === null || month === null || !line || otp === null) continue;

    metrics.push({
      year,
      month,
      lineName: line,
      otpPercent: otp,
      otpPercentAmtrakAdjusted: toNumber(pick(row, ALIASES.otpAdjusted)),
      tripsOperated: toNumber(pick(row, ALIASES.trips)) ?? 0,
      cancellations: toNumber(pick(row, ALIASES.cancellations)) ?? 0,
      cancellationCauses: null,
    });
  }
  return metrics;
}

export function loadOfficialMetrics(repos: Repositories, csv: string): number {
  const metrics = parseOfficialMetrics(csv);
  for (const metric of metrics) repos.official.upsert(metric);
  return metrics.length;
}
