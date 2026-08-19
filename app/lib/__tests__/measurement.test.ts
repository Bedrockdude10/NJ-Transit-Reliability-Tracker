import type { OtpSummary, StationSummaryResponse } from "@njt/shared";
import { describe, expect, it } from "vitest";
import {
  hasConnectionData,
  hasDistributionData,
  hasHeatmapData,
  hasMeasuredOtp,
  hasStationData,
  measurementStatus,
} from "../measurement";

const emptyOtp: OtpSummary = {
  tripsOperated: 0,
  tripsCancelled: 0,
  cancellationRatePercent: 0,
  avgDelaySeconds: 0,
  medianDelaySeconds: 0,
  p90DelaySeconds: 0,
  thresholds: [{ thresholdSeconds: 300, thresholdMinutes: 5, otpPercent: 0, onTimeTrips: 0 }],
  delayDistribution: [{ label: "0-5 min", count: 0 }],
};

describe("hasMeasuredOtp", () => {
  it("is false with zero operated trips and true once trips exist", () => {
    expect(hasMeasuredOtp(emptyOtp)).toBe(false);
    expect(hasMeasuredOtp({ ...emptyOtp, tripsOperated: 12 })).toBe(true);
    expect(hasMeasuredOtp(null)).toBe(false);
  });
});

describe("hasDistributionData", () => {
  it("requires at least one non-zero bucket", () => {
    expect(hasDistributionData([{ label: "0-5 min", count: 0 }])).toBe(false);
    expect(hasDistributionData([{ label: "0-5 min", count: 3 }])).toBe(true);
    expect(hasDistributionData([])).toBe(false);
  });
});

describe("hasHeatmapData", () => {
  it("requires at least one observation", () => {
    expect(hasHeatmapData([{ bucket: 0, label: "Mon", avgDelaySeconds: 0, observations: 0 }])).toBe(false);
    expect(hasHeatmapData([{ bucket: 0, label: "Mon", avgDelaySeconds: 60, observations: 5 }])).toBe(true);
  });
});

describe("hasStationData", () => {
  const emptyStation: StationSummaryResponse = {
    stopId: "1",
    stopName: "Test",
    from: "2025-01-01",
    to: "2025-01-31",
    byLineDirection: [],
    delayDistribution: [{ label: "0-5 min", count: 0 }],
    hourOfDay: [{ bucket: 8, label: "08:00", avgDelaySeconds: 0, observations: 0 }],
    amplification: { arrivedWithin5Min: 0, departedLate: 0, amplificationRatePercent: 0 },
  };

  it("is false when every measured view is empty", () => {
    expect(hasStationData(emptyStation)).toBe(false);
    expect(hasStationData(null)).toBe(false);
  });

  it("is true when any view has observations", () => {
    expect(
      hasStationData({
        ...emptyStation,
        byLineDirection: [{ lineName: "NEC", direction: "inbound", avgArrivalDelaySeconds: 90, observations: 4 }],
      }),
    ).toBe(true);
    expect(hasStationData({ ...emptyStation, amplification: { arrivedWithin5Min: 2, departedLate: 1, amplificationRatePercent: 50 } })).toBe(true);
  });
});

describe("hasConnectionData", () => {
  it("keys off observations", () => {
    expect(hasConnectionData(null)).toBe(false);
    expect(hasConnectionData({ observations: 0 } as never)).toBe(false);
    expect(hasConnectionData({ observations: 30 } as never)).toBe(true);
  });
});

describe("measurementStatus", () => {
  it("reports not-started when there is no collection date", () => {
    const s = measurementStatus(null);
    expect(s.live).toBe(false);
    expect(s.badge).toBe("NO DATA YET");
    expect(s.label).toMatch(/hasn.t started/iu);
  });

  it("reports live and formats the collection-start date", () => {
    const s = measurementStatus("2025-07-15");
    expect(s.live).toBe(true);
    expect(s.badge).toBe("LIVE");
    expect(s.label).toBe("Live · measuring since Jul 15, 2025");
  });
});
