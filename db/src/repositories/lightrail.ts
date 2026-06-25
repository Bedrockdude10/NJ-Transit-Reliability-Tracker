import type { LightRailMdbfMetric, LightRailOtpMetric } from "@njt/shared";
import type { Database } from "../database";

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** Light rail official metrics: systemwide OTP and per-line MDBF. */
export class LightRailRepository {
  constructor(private readonly db: Database) {}

  upsertOtp(metric: LightRailOtpMetric): void {
    this.db
      .prepare(
        "INSERT INTO light_rail_otp (year, month, otp_percent) VALUES (:year, :month, :otp) ON CONFLICT(year, month) DO UPDATE SET otp_percent = excluded.otp_percent",
      )
      .run({ year: metric.year, month: metric.month, otp: metric.otpPercent });
  }

  getOtpForRange(from: { year: number; month: number }, to: { year: number; month: number }): LightRailOtpMetric[] {
    return this.db.all<{ year: number; month: number; otp_percent: number }>(
      "SELECT year, month, otp_percent FROM light_rail_otp WHERE (year * 12 + month - 1) BETWEEN :from AND :to ORDER BY year, month",
      { from: monthIndex(from.year, from.month), to: monthIndex(to.year, to.month) },
    ).map((r) => ({ year: r.year, month: r.month, otpPercent: r.otp_percent }));
  }

  upsertMdbf(metric: LightRailMdbfMetric): void {
    this.db
      .prepare(
        "INSERT INTO light_rail_mdbf (year, month, line_name, mdbf) VALUES (:year, :month, :line, :mdbf) ON CONFLICT(year, month, line_name) DO UPDATE SET mdbf = excluded.mdbf",
      )
      .run({ year: metric.year, month: metric.month, line: metric.lineName, mdbf: metric.mdbf });
  }

  getMdbfForRange(from: { year: number; month: number }, to: { year: number; month: number }): LightRailMdbfMetric[] {
    return this.db.all<{ year: number; month: number; line_name: string; mdbf: number }>(
      "SELECT year, month, line_name, mdbf FROM light_rail_mdbf WHERE (year * 12 + month - 1) BETWEEN :from AND :to ORDER BY line_name, year, month",
      { from: monthIndex(from.year, from.month), to: monthIndex(to.year, to.month) },
    ).map((r) => ({ year: r.year, month: r.month, lineName: r.line_name, mdbf: r.mdbf }));
  }
}
