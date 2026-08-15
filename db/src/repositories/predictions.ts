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
  model_version: string;
  run_id: string;
}

/**
 * Model output, landed from object storage.
 *
 * A landing area, not a source: predictions are produced by `njt-delay-modeling`,
 * written to `predictions/` as gzipped JSON Lines, and imported here so the API
 * can serve them from local reads. Nothing in this repo derives from them.
 *
 * They are pulled into SQLite rather than read from object storage per request
 * for the same reason every other read is local: the request path should not
 * depend on a third party being up, and a bucket outage should not be able to
 * take the site down.
 */
export class PredictionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insert or replace. The key is the leg — (trip, from, to, service date) —
   * because one trip carries a prediction from each stop to each later stop, and
   * keying on the trip alone would keep only the last one imported.
   *
   * Replace rather than ignore: the modelling repo rewrites a whole service date
   * when it re-runs, whether that is a better model or actuals filled in after
   * the trips have run, and the newest write is the authoritative one.
   */
  upsertMany(predictions: readonly DelayPrediction[]): void {
    this.db.transaction(() => this.write(predictions));
  }

  /** The write itself, without a transaction, so callers can compose one. */
  private write(predictions: readonly DelayPrediction[]): void {
    const statement = this.db.prepare(/* sql */ `
      INSERT INTO predictions (
        trip_id, line_name, service_date, from_stop_id, to_stop_id, predicted_at,
        horizon_seconds, predicted_delay_seconds, actual_delay_seconds, model_version, run_id
      ) VALUES (
        :trip_id, :line_name, :service_date, :from_stop_id, :to_stop_id, :predicted_at,
        :horizon_seconds, :predicted_delay_seconds, :actual_delay_seconds, :model_version, :run_id
      )
      ON CONFLICT(trip_id, from_stop_id, to_stop_id, service_date) DO UPDATE SET
        line_name               = excluded.line_name,
        predicted_at            = excluded.predicted_at,
        horizon_seconds         = excluded.horizon_seconds,
        predicted_delay_seconds = excluded.predicted_delay_seconds,
        actual_delay_seconds    = excluded.actual_delay_seconds,
        model_version           = excluded.model_version,
        run_id                  = excluded.run_id
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
        model_version: prediction.modelVersion,
        run_id: prediction.runId,
      });
    }
  }

  /**
   * Replace a whole service date.
   *
   * The unit the modelling repo publishes is a day, and a re-run can emit
   * *fewer* legs than the one before — because the model changed, or because the
   * previous rows were wrong. Upserting alone leaves those orphans in place: a
   * prediction for a leg that no longer exists was still being served after the
   * run that produced it had been corrected and republished.
   *
   * One transaction, so a day is never half-replaced.
   */
  replaceServiceDate(serviceDate: string, predictions: readonly DelayPrediction[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM predictions WHERE service_date = :d", { d: serviceDate });
      this.write(predictions);
    });
  }

  /** Every prediction for a service date, in the order a trip travels. */
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

  /** Service dates holding predictions, oldest first. */
  serviceDates(): string[] {
    return this.db
      .all<{ d: string }>("SELECT DISTINCT service_date AS d FROM predictions ORDER BY d")
      .map((row) => row.d);
  }

  /**
   * The model and run behind the most recent prediction, or null.
   *
   * Shown next to the numbers: a prediction is only as good as the run that made
   * it, and an unlabelled figure invites more confidence than it has earned.
   */
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
    modelVersion: row.model_version,
    runId: row.run_id,
  };
}
