/**
 * Model outputs, as written to object storage by `njt-delay-modeling`.
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
   * How far ahead the prediction reaches: seconds of clock time, never a number
   * of stops.
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
   * Lower bound of the prediction interval, seconds. Absent, not null, when the
   * producer published only a point estimate — so dates written before intervals
   * existed stay valid. Present only together with
   * {@link predictedDelayUpperSeconds} and {@link predictionIntervalPercent};
   * the importer rejects a day carrying part of an interval.
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
   * @unit percent
   */
  predictionIntervalPercent?: number;
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
