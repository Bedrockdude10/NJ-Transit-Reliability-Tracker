import type { PredictedDelay, PredictionsResponse } from "@njt/shared";
import { describe, expect, it } from "vitest";
import {
  accuracyNote,
  byLine,
  formatPredictedDelay,
  intervalNote,
  provenanceNote,
  signedSeconds,
} from "./predictions";

/**
 * How model output is described to a rider.
 *
 * The wording is the substance here. A predicted delay is not a measurement, and
 * a panel that reads like one is a claim the project cannot support — every other
 * number on the site is observed, and this one is guessed.
 */

const LEG: PredictedDelay = {
  tripId: "T1",
  lineName: "Northeast Corridor",
  fromStopName: "Newark Penn Station",
  toStopName: "New York Penn Station",
  horizonSeconds: 1800,
  predictedDelaySeconds: 240,
  interval: null,
  actualDelaySeconds: null,
  errorSeconds: null,
};

const RESPONSE: PredictionsResponse = {
  serviceDate: "2026-08-14",
  available: true,
  availableDates: ["2026-08-14"],
  provenance: {
    modelVersion: "lgbm-0.1.0",
    runId: "abc123def456",
    predictedAtEpochSeconds: 1_786_500_000,
  },
  predictions: [LEG],
  meanAbsoluteErrorSeconds: 95.4,
  scoredCount: 12,
  lines: ["Northeast Corridor"],
  totalPredictions: 1,
};

describe("signedSeconds", () => {
  it("keeps the sign, because the direction of a miss is the point", () => {
    // Reliably late-by-60 and reliably early-by-60 are different failures, and
    // an absolute value hides which one a model has.
    expect(signedSeconds(60)).toBe("+1m");
    expect(signedSeconds(-60)).toBe("−1m");
    expect(signedSeconds(20)).toBe("+20s");
  });

  it("says nothing when there is nothing to say", () => {
    // Null means the trip has not run yet — not that the model was perfect.
    expect(signedSeconds(null)).toBe("—");
  });

  it("does not dress zero up with a sign", () => {
    expect(signedSeconds(0)).toBe("0s");
  });
});

describe("accuracyNote", () => {
  it("leads with how wrong the model has been", () => {
    expect(accuracyNote(RESPONSE)).toBe("Off by 1m 35s on average, across 12 trips that have run.");
    // Thousands separated, as everywhere else on the site.
    expect(accuracyNote({ ...RESPONSE, scoredCount: 49312 })).toContain("49,312 trips");
  });

  it("says the model is unscored when no trip has finished", () => {
    // The state on any day that is still ahead: predictions exist, nothing can
    // be checked yet, and claiming accuracy would be inventing it.
    expect(accuracyNote({ ...RESPONSE, meanAbsoluteErrorSeconds: null, scoredCount: 0 })).toBe(
      "Not yet checked against what happened — no trips on this date have finished.",
    );
  });

  it("uses the singular for one scored trip", () => {
    expect(accuracyNote({ ...RESPONSE, meanAbsoluteErrorSeconds: 30, scoredCount: 1 })).toContain(
      "1 trip that has run",
    );
  });
});

describe("provenanceNote", () => {
  it("names the model and shortens the run id to something quotable", () => {
    // Long enough to find the run in MLflow, short enough to read aloud.
    expect(provenanceNote(RESPONSE.provenance)).toBe("Model lgbm-0.1.0, run abc123de");
  });

  it("has nothing to attribute when nothing has run", () => {
    expect(provenanceNote(null)).toBeNull();
  });
});

describe("byLine", () => {
  it("groups legs under their line, in the order given", () => {
    const other = { ...LEG, tripId: "T2", lineName: "North Jersey Coast" };
    expect(byLine([LEG, other, { ...LEG, tripId: "T3" }])).toEqual([
      { lineName: "Northeast Corridor", legs: [LEG, { ...LEG, tripId: "T3" }] },
      { lineName: "North Jersey Coast", legs: [other] },
    ]);
  });

  it("returns nothing for nothing, rather than an empty group", () => {
    expect(byLine([])).toEqual([]);
  });
});

/**
 * The range, once the modelling repo publishes conformal intervals.
 *
 * The wording argument again, and the strongest instance of it: "8m 24s" reads
 * as a measurement of a train that has not run. A range is what the model can
 * actually support, so where there is one it replaces the point rather than
 * decorating it.
 */
const withInterval = (lowerSeconds: number, upperSeconds: number, percent = 80): PredictedDelay => ({
  ...LEG,
  interval: { lowerSeconds, upperSeconds, percent },
});

describe("formatPredictedDelay", () => {
  it("shows the point estimate when the model published no range", () => {
    expect(formatPredictedDelay(LEG)).toBe("4m");
  });

  it("shows a range instead of the point when the model published one", () => {
    expect(formatPredictedDelay(withInterval(300, 720))).toBe("5m–12m");
  });

  it("reads clearly when a bound is early", () => {
    // An en dash between two values that can carry a minus sign; "−2m-5m" is
    // not readable.
    expect(formatPredictedDelay(withInterval(-120, 300))).toBe("−2m–5m");
  });

  it("collapses a bound within the on-time threshold to zero, as elsewhere", () => {
    expect(formatPredictedDelay(withInterval(10, 300))).toBe("0–5m");
  });
});

describe("intervalNote", () => {
  it("says nothing when no leg carries a range", () => {
    expect(intervalNote([LEG, LEG])).toBeNull();
  });

  it("states the coverage once, rather than on every row", () => {
    expect(intervalNote([withInterval(300, 720), withInterval(60, 200)])).toMatch(
      /80% prediction intervals/u,
    );
  });

  it("names every coverage if a run mixes them, rather than picking one", () => {
    expect(intervalNote([withInterval(300, 720, 90), withInterval(60, 200, 50)])).toMatch(
      /50% \/ 90%/u,
    );
  });

  it("ignores legs without a range when some have one", () => {
    expect(intervalNote([LEG, withInterval(300, 720)])).toMatch(/80%/u);
  });
});
