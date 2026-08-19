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
 * NJT's published rail performance CSVs, one set per line, keyed by a code in the
 * filename (`RAIL_<CODE>_OTP_DATA.csv`, `…_AMTRAK_ADJUSTED`, `…_CANCELLATIONS_DATA`).
 * Each file has a dashed separator row under the header and space-padded values.
 * The systemwide `RAIL_*_DATA.csv` are deliberately skipped: the API derives the
 * system figure as the trips-weighted aggregate of the lines, as NJT does.
 */

const MONTH_LABEL_RE = /^(?<year>\d{4})\s+(?<monthName>[A-Za-z]+)/u;
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
  const n = Number(value.replace(/[,%\s]/gu, ""));
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

function parseYearMonthLabel(label: string | undefined): { year: number; month: number } | null {
  const match = MONTH_LABEL_RE.exec(label ?? "");
  const month = match ? MONTH_NUMBERS[match.groups?.monthName?.toUpperCase() ?? ""] : undefined;
  return match && month ? { year: Number(match.groups?.year), month } : null;
}

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

  const mdbfCsv = read("RAIL_MDBF_DATA.csv");
  if (mdbfCsv) {
    const rows = parseMdbf(mdbfCsv);
    for (const row of rows) repos.official.upsertMdbf(row);
    result.mdbfMonths = rows.length;
  }

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
