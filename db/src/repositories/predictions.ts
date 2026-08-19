import type { DelayPrediction } from "@njt/shared";
import type { Database } from "../database";

interface PredictionRow {
  trip_id: string;
  line_name: string;
  service_date: string;
  from_stop_id: string;
  to_stop_id: string;
  predicted_at: number;
  horizon_seconds: number;
  predicted_delay_seconds: number;
  actual_delay_seconds: number | null;
  predicted_delay_lower_seconds: number | null;
  predicted_delay_upper_seconds: number | null;
  prediction_interval_percent: number | null;
  model_version: string;
  run_id: string;
}

/** Model output, landed from object storage. Nothing in this repo derives from it. */
export class PredictionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Keyed on the leg, not the trip: one trip carries a prediction from each stop
   * to each later stop. Replace, not ignore — a re-run of a service date is
   * authoritative over what it supersedes.
   */
  upsertMany(predictions: readonly DelayPrediction[]): void {
    this.db.transaction(() => this.write(predictions));
  }

  /** Untransacted, so callers can compose one. */
  private write(predictions: readonly DelayPrediction[]): void {
    const statement = this.db.prepare(/* sql */ `
      INSERT INTO predictions (
        trip_id, line_name, service_date, from_stop_id, to_stop_id, predicted_at,
        horizon_seconds, predicted_delay_seconds, actual_delay_seconds,
        predicted_delay_lower_seconds, predicted_delay_upper_seconds, prediction_interval_percent,
        model_version, run_id
      ) VALUES (
        :trip_id, :line_name, :service_date, :from_stop_id, :to_stop_id, :predicted_at,
        :horizon_seconds, :predicted_delay_seconds, :actual_delay_seconds,
        :predicted_delay_lower_seconds, :predicted_delay_upper_seconds, :prediction_interval_percent,
        :model_version, :run_id
      )
      ON CONFLICT(trip_id, from_stop_id, to_stop_id, service_date) DO UPDATE SET
        line_name                     = excluded.line_name,
        predicted_at                  = excluded.predicted_at,
        horizon_seconds               = excluded.horizon_seconds,
        predicted_delay_seconds       = excluded.predicted_delay_seconds,
        actual_delay_seconds          = excluded.actual_delay_seconds,
        -- Replaced, not coalesced: a re-run that drops its interval is a model
        -- that stopped publishing one, and keeping the old range would attach a
        -- stale confidence to a fresh estimate.
        predicted_delay_lower_seconds = excluded.predicted_delay_lower_seconds,
        predicted_delay_upper_seconds = excluded.predicted_delay_upper_seconds,
        prediction_interval_percent   = excluded.prediction_interval_percent,
        model_version                 = excluded.model_version,
        run_id                        = excluded.run_id
    `);

    for (const prediction of predictions) {
      statement.run({
        trip_id: prediction.tripId,
        line_name: prediction.lineName,
        service_date: prediction.serviceDate,
        from_stop_id: prediction.fromStopId,
        to_stop_id: prediction.toStopId,
        predicted_at: prediction.predictedAtEpochSeconds,
        horizon_seconds: prediction.horizonSeconds,
        predicted_delay_seconds: prediction.predictedDelaySeconds,
        actual_delay_seconds: prediction.actualDelaySeconds,
        // `undefined` would fail to bind; SQLite has no unset parameter.
        predicted_delay_lower_seconds: prediction.predictedDelayLowerSeconds ?? null,
        predicted_delay_upper_seconds: prediction.predictedDelayUpperSeconds ?? null,
        prediction_interval_percent: prediction.predictionIntervalPercent ?? null,
        model_version: prediction.modelVersion,
        run_id: prediction.runId,
      });
    }
  }

  /**
   * Delete-then-write, in one transaction: a re-run can emit *fewer* legs than
   * the one before, and upserting alone would leave the orphans being served.
   */
  replaceServiceDate(serviceDate: string, predictions: readonly DelayPrediction[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM predictions WHERE service_date = :d", { d: serviceDate });
      this.write(predictions);
    });
  }

  forServiceDate(serviceDate: string): DelayPrediction[] {
    return this.db
      .all<PredictionRow>(
        /* sql */ `
          SELECT * FROM predictions
          WHERE service_date = :d
          ORDER BY trip_id, horizon_seconds, to_stop_id
        `,
        { d: serviceDate },
      )
      .map(toPrediction);
  }

  serviceDates(): string[] {
    return this.db
      .all<{ d: string }>("SELECT DISTINCT service_date AS d FROM predictions ORDER BY d")
      .map((row) => row.d);
  }

  latestRun(): { modelVersion: string; runId: string; predictedAtEpochSeconds: number } | null {
    const row = this.db.get<{ model_version: string; run_id: string; predicted_at: number }>(
      "SELECT model_version, run_id, predicted_at FROM predictions ORDER BY predicted_at DESC LIMIT 1",
    );
    return row
      ? {
          modelVersion: row.model_version,
          runId: row.run_id,
          predictedAtEpochSeconds: row.predicted_at,
        }
      : null;
  }
}

function toPrediction(row: PredictionRow): DelayPrediction {
  return {
    tripId: row.trip_id,
    lineName: row.line_name,
    serviceDate: row.service_date,
    fromStopId: row.from_stop_id,
    toStopId: row.to_stop_id,
    predictedAtEpochSeconds: row.predicted_at,
    horizonSeconds: row.horizon_seconds,
    predictedDelaySeconds: row.predicted_delay_seconds,
    actualDelaySeconds: row.actual_delay_seconds,
    ...intervalOf(row),
    modelVersion: row.model_version,
    runId: row.run_id,
  };
}

/**
 * Spread, so a row without an interval yields the keys *absent* rather than
 * null: the contract types them as numbers and forbids unknowns, so a null
 * would fail validation on the other side of the seam.
 */
function intervalOf(row: PredictionRow): Partial<DelayPrediction> {
  if (row.predicted_delay_lower_seconds === null) return {};
  return {
    predictedDelayLowerSeconds: row.predicted_delay_lower_seconds,
    ...(row.predicted_delay_upper_seconds !== null
      ? { predictedDelayUpperSeconds: row.predicted_delay_upper_seconds }
      : {}),
    ...(row.prediction_interval_percent !== null
      ? { predictionIntervalPercent: row.prediction_interval_percent }
      : {}),
  };
}
