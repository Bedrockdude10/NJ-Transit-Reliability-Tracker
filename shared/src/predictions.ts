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
   * @unit epoch_seconds
   */
  predictedAtEpochSeconds: number;
  /**
   * How far ahead the prediction reaches, in seconds.
   *
   * Seconds of clock time, never a number of stops — this field once carried a
   * stop count, which every check on both sides accepted because the unit lived
   * only in the name. It is now declared, emitted and enforced.
   * @format int
   * @unit seconds
   */
  horizonSeconds: number;
  /**
   * Predicted delay at `toStopId`, seconds; positive = late.
   * @unit seconds
   */
  predictedDelaySeconds: number;
  /**
   * Observed delay once known, for scoring. Null until the trip has run.
   * @unit seconds
   */
  actualDelaySeconds: number | null;
  /**
   * Lower bound of the prediction interval, seconds.
   *
   * Optional, and optional in the honest sense: a model that publishes only a
   * point estimate is a valid producer, and every service date written before
   * intervals existed stays valid unchanged. Absent, not null — a day with no
   * interval carries no key, rather than a key asserting there is no bound.
   *
   * Present only together with {@link predictedDelayUpperSeconds} and
   * {@link predictionIntervalPercent}; the importer rejects a day carrying part
   * of an interval, since a bound with no stated confidence says nothing.
   * @unit seconds
   */
  predictedDelayLowerSeconds?: number;
  /**
   * Upper bound of the prediction interval, seconds.
   * @unit seconds
   */
  predictedDelayUpperSeconds?: number;
  /**
   * Coverage of that interval — 80 means an 80% interval, so 8 runs in 10 are
   * expected to land inside it.
   *
   * A range is only meaningful with its confidence attached: "5 to 12 minutes
   * late" is a different claim at 50% than at 95%, and a rider reading the
   * first as the second is the failure this field exists to prevent.
   * @unit percent
   */
  predictionIntervalPercent?: number;
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
  /** @unit seconds */
  horizonSeconds: number;
  /**
   * @format int
   * @unit count
   */
  predictions: number;
  /**
   * Mean absolute error, seconds.
   * @unit seconds
   */
  maeSeconds: number;
  /**
   * Mean signed error: negative means the model is optimistic.
   * @unit seconds
   */
  biasSeconds: number;
  /**
   * Share of predictions that were reassuring but wrong, 0-100.
   * @unit percent
   */
  falselyReassuringPercent: number;
}
