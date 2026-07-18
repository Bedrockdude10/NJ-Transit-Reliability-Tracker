import type { FleetMdbfMetric, OfficialNjtMetric } from "@njt/shared";
import type { Database } from "../database";
import { parseCountMap, serializeJson } from "../json";

interface MetricRow {
  year: number;
  month: number;
  line_name: string;
  otp_percent: number;
  otp_percent_amtrak_adjusted: number | null;
  trips_operated: number;
  cancellations: number;
  cancellation_causes: string | null;
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
    cancellationCauses: row.cancellation_causes ? parseCountMap(row.cancellation_causes) : null,
  };
}

/** Explicit column list for metric reads (B5: no SELECT *). */
const METRIC_COLUMNS =
  "year, month, line_name, otp_percent, otp_percent_amtrak_adjusted, trips_operated, cancellations, cancellation_causes";

/** NJT's officially published monthly OTP, used as the comparison baseline. */
export class OfficialMetricRepository {
  constructor(private readonly db: Database) {}

  upsert(metric: OfficialNjtMetric): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO official_njt_metrics (
          year, month, line_name, otp_percent, otp_percent_amtrak_adjusted,
          trips_operated, cancellations, cancellation_causes
        ) VALUES (:year, :month, :line, :otp, :otpAdj, :trips, :cancellations, :causes)
        ON CONFLICT(year, month, line_name) DO UPDATE SET
          otp_percent                 = excluded.otp_percent,
          otp_percent_amtrak_adjusted = excluded.otp_percent_amtrak_adjusted,
          trips_operated              = excluded.trips_operated,
          cancellations               = excluded.cancellations,
          cancellation_causes         = excluded.cancellation_causes
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
        causes: metric.cancellationCauses ? serializeJson(metric.cancellationCauses) : null,
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
        SELECT ${METRIC_COLUMNS} FROM official_njt_metrics
        WHERE line_name = :line AND (year, month) >= (:fromY, :fromM) AND (year, month) <= (:toY, :toM)
        ORDER BY year, month
      `,
        { line: lineName, fromY: from.year, fromM: from.month, toY: to.year, toM: to.month },
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
        SELECT ${METRIC_COLUMNS} FROM official_njt_metrics
        WHERE (year, month) >= (:fromY, :fromM) AND (year, month) <= (:toY, :toM)
        ORDER BY year, month, line_name
      `,
        { fromY: from.year, fromM: from.month, toY: to.year, toM: to.month },
      )
      .map(toMetric);
  }

  /** Full monthly history for a line (the Line Detail comparison table). */
  getAllForLine(lineName: string): OfficialNjtMetric[] {
    return this.db
      .all<MetricRow>(`SELECT ${METRIC_COLUMNS} FROM official_njt_metrics WHERE line_name = :line ORDER BY year, month`, {
        line: lineName,
      })
      .map(toMetric);
  }

  /**
   * The single most-recent published metric for every line, in one query — the
   * `/lines` list only needs each line's latest month, so this replaces an N+1
   * of one full-history query per line.
   */
  latestPerLine(): Map<string, OfficialNjtMetric> {
    const rows = this.db
      .all<MetricRow>(
        /* sql */ `
        SELECT t.* FROM official_njt_metrics t
        JOIN (
          SELECT line_name, MAX(year * 12 + month - 1) AS mi
          FROM official_njt_metrics GROUP BY line_name
        ) m ON t.line_name = m.line_name AND (t.year * 12 + t.month - 1) = m.mi
      `,
      )
      .map(toMetric);
    return new Map(rows.map((r) => [r.lineName, r]));
  }

  // --- Fleet MDBF (systemwide mean distance between failures) ---------------

  upsertMdbf(metric: FleetMdbfMetric): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO official_fleet_mdbf (year, month, mdbf) VALUES (:year, :month, :mdbf)
        ON CONFLICT(year, month) DO UPDATE SET mdbf = excluded.mdbf
      `,
      )
      .run({ year: metric.year, month: metric.month, mdbf: metric.mdbf });
  }

  /** MDBF rows across an inclusive month range. */
  getMdbfForRange(
    from: { year: number; month: number },
    to: { year: number; month: number },
  ): FleetMdbfMetric[] {
    return this.db.all<FleetMdbfMetric>(
      "SELECT year, month, mdbf FROM official_fleet_mdbf WHERE (year, month) >= (:fromY, :fromM) AND (year, month) <= (:toY, :toM) ORDER BY year, month",
      { fromY: from.year, fromM: from.month, toY: to.year, toM: to.month },
    );
  }
}
