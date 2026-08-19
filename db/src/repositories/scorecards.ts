import type { ModelScorecard } from "@njt/shared";
import type { Database } from "../database";

interface ScorecardRow {
  model_version: string;
  run_id: string;
  service_date: string;
  horizon_seconds: number;
  predictions: number;
  mae_seconds: number;
  bias_seconds: number;
  falsely_reassuring_percent: number;
}

/** Per-model accuracy, landed from object storage. Nothing here derives from it. */
export class ScorecardRepository {
  constructor(private readonly db: Database) {}

  upsertMany(scorecards: readonly ModelScorecard[]): void {
    this.db.transaction(() => this.write(scorecards));
  }

  /** Untransacted, so callers can compose one. */
  private write(scorecards: readonly ModelScorecard[]): void {
    const statement = this.db.prepare(/* sql */ `
      INSERT INTO model_scorecards (
        model_version, run_id, service_date, horizon_seconds, predictions,
        mae_seconds, bias_seconds, falsely_reassuring_percent
      ) VALUES (
        :model_version, :run_id, :service_date, :horizon_seconds, :predictions,
        :mae_seconds, :bias_seconds, :falsely_reassuring_percent
      )
      ON CONFLICT(model_version, run_id, service_date, horizon_seconds) DO UPDATE SET
        predictions                = excluded.predictions,
        mae_seconds                = excluded.mae_seconds,
        bias_seconds               = excluded.bias_seconds,
        falsely_reassuring_percent = excluded.falsely_reassuring_percent
    `);

    for (const card of scorecards) {
      statement.run({
        model_version: card.modelVersion,
        run_id: card.runId,
        service_date: card.serviceDate,
        horizon_seconds: card.horizonSeconds,
        predictions: card.predictions,
        mae_seconds: card.maeSeconds,
        bias_seconds: card.biasSeconds,
        falsely_reassuring_percent: card.falselyReassuringPercent,
      });
    }
  }

  /**
   * Delete-then-write, in one transaction: a re-run can score fewer horizons than
   * the one before, and upserting alone would leave the orphans being served.
   */
  replaceServiceDate(serviceDate: string, scorecards: readonly ModelScorecard[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM model_scorecards WHERE service_date = :d", { d: serviceDate });
      this.write(scorecards);
    });
  }

  forServiceDate(serviceDate: string): ModelScorecard[] {
    return this.db
      .all<ScorecardRow>(
        /* sql */ `
          SELECT * FROM model_scorecards
          WHERE service_date = :d
          ORDER BY model_version, run_id, horizon_seconds
        `,
        { d: serviceDate },
      )
      .map(toScorecard);
  }

  all(): ModelScorecard[] {
    return this.db
      .all<ScorecardRow>(
        "SELECT * FROM model_scorecards ORDER BY service_date, model_version, horizon_seconds",
      )
      .map(toScorecard);
  }

  serviceDates(): string[] {
    return this.db
      .all<{ d: string }>("SELECT DISTINCT service_date AS d FROM model_scorecards ORDER BY d")
      .map((row) => row.d);
  }

  modelVersions(): string[] {
    return this.db
      .all<{ v: string }>(
        "SELECT DISTINCT model_version AS v FROM model_scorecards ORDER BY model_version",
      )
      .map((row) => row.v);
  }
}

function toScorecard(row: ScorecardRow): ModelScorecard {
  return {
    modelVersion: row.model_version,
    runId: row.run_id,
    serviceDate: row.service_date,
    horizonSeconds: row.horizon_seconds,
    predictions: row.predictions,
    maeSeconds: row.mae_seconds,
    biasSeconds: row.bias_seconds,
    falselyReassuringPercent: row.falsely_reassuring_percent,
  };
}
