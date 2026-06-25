import type { OfficialNjtMetric } from "@njt/shared";
import type { Database } from "../database";

interface MetricRow {
  year: number;
  month: number;
  line_name: string;
  otp_percent: number;
  otp_percent_amtrak_adjusted: number | null;
  trips_operated: number;
  cancellations: number;
}

function toMetric(row: MetricRow): OfficialNjtMetric {
  return {
    year: row.year,
    month: row.month,
    lineName: row.line_name,
    otpPercent: row.otp_percent,
    otpPercentAmtrakAdjusted: row.otp_percent_amtrak_adjusted,
    tripsOperated: row.trips_operated,
    cancellations: row.cancellations,
  };
}

/** A month encoded as a single comparable integer (year * 12 + monthIndex). */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** NJT's officially published monthly OTP, used as the comparison baseline. */
export class OfficialMetricRepository {
  constructor(private readonly db: Database) {}

  upsert(metric: OfficialNjtMetric): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO official_njt_metrics (
          year, month, line_name, otp_percent, otp_percent_amtrak_adjusted,
          trips_operated, cancellations
        ) VALUES (:year, :month, :line, :otp, :otpAdj, :trips, :cancellations)
        ON CONFLICT(year, month, line_name) DO UPDATE SET
          otp_percent                 = excluded.otp_percent,
          otp_percent_amtrak_adjusted = excluded.otp_percent_amtrak_adjusted,
          trips_operated              = excluded.trips_operated,
          cancellations               = excluded.cancellations
      `,
      )
      .run({
        year: metric.year,
        month: metric.month,
        line: metric.lineName,
        otp: metric.otpPercent,
        otpAdj: metric.otpPercentAmtrakAdjusted,
        trips: metric.tripsOperated,
        cancellations: metric.cancellations,
      });
  }

  /** Metrics for a line across an inclusive month range. */
  getForLineRange(
    lineName: string,
    from: { year: number; month: number },
    to: { year: number; month: number },
  ): OfficialNjtMetric[] {
    return this.db
      .all<MetricRow>(
        /* sql */ `
        SELECT * FROM official_njt_metrics
        WHERE line_name = :line AND (year * 12 + month - 1) BETWEEN :from AND :to
        ORDER BY year, month
      `,
        { line: lineName, from: monthIndex(from.year, from.month), to: monthIndex(to.year, to.month) },
      )
      .map(toMetric);
  }

  /** All lines' metrics across an inclusive month range (system rollup). */
  getAllForRange(
    from: { year: number; month: number },
    to: { year: number; month: number },
  ): OfficialNjtMetric[] {
    return this.db
      .all<MetricRow>(
        /* sql */ `
        SELECT * FROM official_njt_metrics
        WHERE (year * 12 + month - 1) BETWEEN :from AND :to
        ORDER BY year, month, line_name
      `,
        { from: monthIndex(from.year, from.month), to: monthIndex(to.year, to.month) },
      )
      .map(toMetric);
  }

  /** Full monthly history for a line (the Line Detail comparison table). */
  getAllForLine(lineName: string): OfficialNjtMetric[] {
    return this.db
      .all<MetricRow>("SELECT * FROM official_njt_metrics WHERE line_name = :line ORDER BY year, month", {
        line: lineName,
      })
      .map(toMetric);
  }
}
