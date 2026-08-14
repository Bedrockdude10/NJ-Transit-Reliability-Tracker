/**
 * Model outputs, as written to object storage by `njt-delay-modeling`.
 *
 * Declared here rather than in the Python repo because TypeScript is the schema
 * authority for every data contract in this system: the API has to read these,
 * and one generation direction (TS → JSON Schema → pydantic) is far easier to
 * keep honest than two. The modelling repo validates against the generated
 * pydantic model before writing, so a mismatch fails there rather than surfacing
 * as a blank panel here.
 *
 * Self-contained on purpose — no imports — so the schema generator can read it
 * without inlining anything.
 */

/** A predicted terminal delay for one trip, made at a known point in time. */
export interface DelayPrediction {
  tripId: string;
  lineName: string;
  /** GTFS service date the trip belongs to, `YYYY-MM-DD`. */
  serviceDate: string;
  /** Stop the prediction was made from. */
  fromStopId: string;
  /** Stop the prediction is about. */
  toStopId: string;
  /**
   * When the prediction was made, epoch seconds UTC.
   * @format int
   */
  predictedAtEpochSeconds: number;
  /**
   * How far ahead the prediction reaches, in seconds.
   * @format int
   */
  horizonSeconds: number;
  /** Predicted delay at `toStopId`, seconds; positive = late. */
  predictedDelaySeconds: number;
  /** Observed delay once known, for scoring. Null until the trip has run. */
  actualDelaySeconds: number | null;
  /** Identifies the model and training run that produced this. */
  modelVersion: string;
  /** MLflow run id, so a prediction can be traced to its experiment. */
  runId: string;
}

/** One row per (model, service date) summarising how the model scored. */
export interface ModelScorecard {
  modelVersion: string;
  runId: string;
  serviceDate: string;
  horizonSeconds: number;
  /** @format int */
  predictions: number;
  /** Mean absolute error, seconds. */
  maeSeconds: number;
  /** Mean signed error: negative means the model is optimistic. */
  biasSeconds: number;
  /** Share of predictions that were reassuring but wrong, 0-100. */
  falselyReassuringPercent: number;
}
