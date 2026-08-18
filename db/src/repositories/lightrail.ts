import type { LightRailMdbfMetric, LightRailOtpMetric, YearMonth } from "@njt/shared";
import type { Database } from "../database";

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
      "SELECT year, month, otp_percent FROM light_rail_otp WHERE (year, month) >= (:fromY, :fromM) AND (year, month) <= (:toY, :toM) ORDER BY year, month",
      { fromY: from.year, fromM: from.month, toY: to.year, toM: to.month },
    ).map((r) => ({ year: r.year, month: r.month, otpPercent: r.otp_percent }));
  }

  upsertMdbf(metric: LightRailMdbfMetric): void {
    this.db
      .prepare(
        "INSERT INTO light_rail_mdbf (year, month, line_name, mdbf) VALUES (:year, :month, :line, :mdbf) ON CONFLICT(year, month, line_name) DO UPDATE SET mdbf = excluded.mdbf",
      )
      .run({ year: metric.year, month: metric.month, line: metric.lineName, mdbf: metric.mdbf });
  }

  latestOtpMonth(): YearMonth | null {
    return this.db.get<YearMonth>("SELECT year, month FROM light_rail_otp ORDER BY year DESC, month DESC LIMIT 1") ?? null;
  }

  getMdbfForRange(from: { year: number; month: number }, to: { year: number; month: number }): LightRailMdbfMetric[] {
    return this.db.all<{ year: number; month: number; line_name: string; mdbf: number }>(
      "SELECT year, month, line_name, mdbf FROM light_rail_mdbf WHERE (year, month) >= (:fromY, :fromM) AND (year, month) <= (:toY, :toM) ORDER BY line_name, year, month",
      { fromY: from.year, fromM: from.month, toY: to.year, toM: to.month },
    ).map((r) => ({ year: r.year, month: r.month, lineName: r.line_name, mdbf: r.mdbf }));
  }
}
