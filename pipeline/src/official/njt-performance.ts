import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Repositories } from "@njt/db";
import {
  findLineById,
  type FleetMdbfMetric,
  type LightRailMdbfMetric,
  type LightRailOtpMetric,
  type OfficialNjtMetric,
} from "@njt/shared";
import { parseCsv } from "../csv";

/**
 * Importer for NJ Transit's published rail performance CSVs (downloaded from
 * njtransit.com/performance-data-download — no API key required). NJT splits the
 * data across one set of files per line, identified by a code in the filename:
 *
 *   RAIL_<CODE>_OTP_DATA.csv                  YEAR, MONTH, <label>, COUNT, TOTAL, PERCENTAGE
 *   RAIL_<CODE>_OTP_DATA_AMTRAK_ADJUSTED.csv  (same shape; Amtrak delays excluded)
 *   RAIL_<CODE>_CANCELLATIONS_DATA.csv        YEAR, MONTH, CATEGORY, CANCEL_COUNT, CANCEL_TOTAL, ...
 *
 * Files have a dashed separator row under the header and space-padded values.
 * The systemwide RAIL_*_DATA.csv files are intentionally not imported — the API
 * derives the system figure as the trips-weighted aggregate of the lines, which
 * is exactly how NJT's systemwide number is composed.
 */

const MONTH_NUMBERS: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

/** NJT performance-file line codes → reference catalog line id. */
export const CODE_TO_LINE_ID: Record<string, string> = {
  ACRL: "atlantic-city",
  BNTN: "montclair-boonton",
  MNBN: "main-bergen",
  MNE: "morris-essex",
  NEC: "northeast-corridor",
  NJCL: "north-jersey-coast",
  PASC: "pascack-valley",
  RARV: "raritan-valley",
};

function toNum(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** `${year}-${month}` key, or null for the dashed separator / malformed rows. */
function monthKey(yearRaw: string | undefined, monthRaw: string | undefined): string | null {
  const year = toNum(yearRaw);
  const month = monthRaw ? MONTH_NUMBERS[monthRaw.trim().toUpperCase()] : undefined;
  return year !== null && month ? `${year}-${month}` : null;
}

interface OtpEntry {
  otpPercent: number;
  tripsOperated: number;
}

/** Parse an OTP CSV into `month → { otpPercent, tripsOperated }`. */
export function parseOtpData(csv: string): Map<string, OtpEntry> {
  const out = new Map<string, OtpEntry>();
  for (const row of parseCsv(csv)) {
    const key = monthKey(row.YEAR, row.MONTH);
    const otp = toNum(row.PERCENTAGE);
    if (!key || otp === null) continue;
    out.set(key, { otpPercent: otp, tripsOperated: toNum(row.TOTAL) ?? 0 });
  }
  return out;
}

/** Parse a cancellations CSV into `month → totalCancellations` (CANCEL_TOTAL). */
export function parseCancellationsData(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of parseCsv(csv)) {
    const key = monthKey(row.YEAR, row.MONTH);
    const total = toNum(row.CANCEL_TOTAL);
    if (!key || total === null) continue;
    out.set(key, total); // constant across the month's category rows
  }
  return out;
}

/** Parse a cancellations CSV into `month → { cause: count }` by category. */
export function parseCancellationCauses(csv: string): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const row of parseCsv(csv)) {
    const key = monthKey(row.YEAR, row.MONTH);
    const cause = row.CATEGORY?.trim();
    const count = toNum(row.CANCEL_COUNT);
    if (!key || !cause || count === null) continue;
    const map = out.get(key) ?? {};
    map[cause] = (map[cause] ?? 0) + count;
    out.set(key, map);
  }
  return out;
}

/** Parse a "YYYY MonthName" label (used by the MDBF / light rail files). */
function parseYearMonthLabel(label: string | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})\s+([A-Za-z]+)/.exec(label ?? "");
  const month = match ? MONTH_NUMBERS[match[2]!.toUpperCase()] : undefined;
  return match && month ? { year: Number(match[1]), month } : null;
}

/** Parse the systemwide MDBF CSV (MONTH column is "YYYY MonthName"). */
export function parseMdbf(csv: string): FleetMdbfMetric[] {
  const out: FleetMdbfMetric[] = [];
  for (const row of parseCsv(csv)) {
    const ym = parseYearMonthLabel(row.MONTH);
    const mdbf = toNum(row.MDBF);
    if (!ym || mdbf === null) continue;
    out.push({ year: ym.year, month: ym.month, mdbf });
  }
  return out;
}

/** Parse the systemwide light rail OTP CSV (MONTH "YYYY MonthName", OTP). */
export function parseLightRailOtp(csv: string): LightRailOtpMetric[] {
  const out: LightRailOtpMetric[] = [];
  for (const row of parseCsv(csv)) {
    const ym = parseYearMonthLabel(row.MONTH);
    const otp = toNum(row.OTP);
    if (!ym || otp === null) continue;
    out.push({ year: ym.year, month: ym.month, otpPercent: otp });
  }
  return out;
}

/** Parse the per-line light rail MDBF CSV (MONTH "YYYY MonthName", LINE, MDBF). */
export function parseLightRailMdbf(csv: string): LightRailMdbfMetric[] {
  const out: LightRailMdbfMetric[] = [];
  for (const row of parseCsv(csv)) {
    const ym = parseYearMonthLabel(row.MONTH);
    const line = row.LINE?.trim();
    const mdbf = toNum(row.MDBF);
    if (!ym || !line || mdbf === null) continue;
    out.push({ year: ym.year, month: ym.month, lineName: line, mdbf });
  }
  return out;
}

/** Join a line's OTP, Amtrak-adjusted OTP, and cancellations into metrics. */
export function buildLineMetrics(
  lineName: string,
  otpCsv: string,
  amtrakAdjustedCsv: string | null,
  cancellationsCsv: string | null,
): OfficialNjtMetric[] {
  const otp = parseOtpData(otpCsv);
  const adjusted = amtrakAdjustedCsv ? parseOtpData(amtrakAdjustedCsv) : new Map<string, OtpEntry>();
  const cancellations = cancellationsCsv ? parseCancellationsData(cancellationsCsv) : new Map<string, number>();
  const causes = cancellationsCsv ? parseCancellationCauses(cancellationsCsv) : new Map<string, Record<string, number>>();

  const metrics: OfficialNjtMetric[] = [];
  for (const [key, entry] of otp) {
    const [year, month] = key.split("-").map(Number) as [number, number];
    metrics.push({
      year,
      month,
      lineName,
      otpPercent: entry.otpPercent,
      otpPercentAmtrakAdjusted: adjusted.get(key)?.otpPercent ?? null,
      tripsOperated: entry.tripsOperated,
      cancellations: cancellations.get(key) ?? 0,
      cancellationCauses: causes.get(key) ?? null,
    });
  }
  return metrics;
}

export interface PerformanceImportResult {
  lines: { lineName: string; metrics: number }[];
  totalMetrics: number;
  mdbfMonths: number;
  lightRailOtpMonths: number;
  lightRailMdbfRows: number;
}

/** Import every per-line performance file present in `dir` into the db. */
export function importNjtPerformanceDir(repos: Repositories, dir: string): PerformanceImportResult {
  const read = (name: string): string | null => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };

  const result: PerformanceImportResult = {
    lines: [],
    totalMetrics: 0,
    mdbfMonths: 0,
    lightRailOtpMonths: 0,
    lightRailMdbfRows: 0,
  };
  for (const [code, lineId] of Object.entries(CODE_TO_LINE_ID)) {
    const otpCsv = read(`RAIL_${code}_OTP_DATA.csv`);
    if (!otpCsv) continue;
    const lineName = findLineById(lineId)?.name ?? lineId;
    const metrics = buildLineMetrics(
      lineName,
      otpCsv,
      read(`RAIL_${code}_OTP_DATA_AMTRAK_ADJUSTED.csv`),
      read(`RAIL_${code}_CANCELLATIONS_DATA.csv`),
    );
    for (const metric of metrics) repos.official.upsert(metric);
    result.lines.push({ lineName, metrics: metrics.length });
    result.totalMetrics += metrics.length;
  }

  // Systemwide fleet reliability (MDBF).
  const mdbfCsv = read("RAIL_MDBF_DATA.csv");
  if (mdbfCsv) {
    const rows = parseMdbf(mdbfCsv);
    for (const row of rows) repos.official.upsertMdbf(row);
    result.mdbfMonths = rows.length;
  }

  // Light rail (systemwide OTP + per-line MDBF).
  const lightRailOtpCsv = read("LIGHTRAIL_OTP_DATA.csv");
  if (lightRailOtpCsv) {
    const rows = parseLightRailOtp(lightRailOtpCsv);
    for (const row of rows) repos.lightRail.upsertOtp(row);
    result.lightRailOtpMonths = rows.length;
  }
  const lightRailMdbfCsv = read("LIGHTRAIL_MDBF_DATA.csv");
  if (lightRailMdbfCsv) {
    const rows = parseLightRailMdbf(lightRailMdbfCsv);
    for (const row of rows) repos.lightRail.upsertMdbf(row);
    result.lightRailMdbfRows = rows.length;
  }
  return result;
}
