import type { NjtOfficialComparison, OtpSummary } from "@njt/shared";
import type { DateRange } from "./dates";

type Cell = string | number;

const NEEDS_QUOTING_RE = /[",\n\r]/u;
const DOUBLE_QUOTE_RE = /"/gu;

function escapeCell(value: Cell): string {
  const s = String(value);
  return NEEDS_QUOTING_RE.test(s) ? `"${s.replace(DOUBLE_QUOTE_RE, '""')}"` : s;
}

export function toCsv(rows: readonly Cell[][]): string {
  return `${rows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;
}

export function summaryToCsv(
  title: string,
  range: DateRange,
  summary: OtpSummary,
  official: NjtOfficialComparison | null,
): string {
  const rows: Cell[][] = [
    [`NJ Transit Reliability — ${title}`],
    ["Range", range.from, range.to],
    [],
    ["Metric", "Value"],
    ["Trips operated", summary.tripsOperated],
    ["Trips cancelled", summary.tripsCancelled],
    ["Cancellation rate (%)", summary.cancellationRatePercent],
    ["Average delay (s)", summary.avgDelaySeconds],
    ["Median delay (s)", summary.medianDelaySeconds],
    ["P90 delay (s)", summary.p90DelaySeconds],
    [],
    ["OTP threshold (min)", "OTP (%)", "On-time trips"],
    ...summary.thresholds.map((t): Cell[] => [t.thresholdMinutes, t.otpPercent, t.onTimeTrips]),
  ];

  if (official) {
    rows.push(
      [],
      ["NJT official OTP (%) — 6 min", official.otpPercent],
      ["NJT official Amtrak-adjusted (%)", official.otpPercentAmtrakAdjusted ?? ""],
      ["Months covered", official.monthsCovered],
    );
  }

  rows.push([], ["Delay bucket", "Count"], ...summary.delayDistribution.map((b): Cell[] => [b.label, b.count]));
  return toCsv(rows);
}
