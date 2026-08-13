import type { ObservedJourney } from "@njt/db";
import { describe, expect, it } from "vitest";
import {
  buildCommuteDepartures,
  departureMinutes,
  formatDepartureLabel,
  medianOf,
  percentileOf,
  rankDepartures,
} from "../src/commute";

/** 2026-08-13, times given in NJT local hours. */
function at(hour: number, minute: number, dayOffset = 0): number {
  return Date.parse(`2026-08-1${3 + dayOffset}T${String(hour + 4).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000;
}

function journey(overrides: Partial<ObservedJourney> = {}): ObservedJourney {
  return {
    tripId: "T1",
    serviceDate: "2026-08-13",
    lineName: "Northeast Corridor Line",
    routeId: "NE",
    direction: "inbound",
    scheduledDeparture: at(7, 42),
    originDelaySeconds: 0,
    scheduledArrival: at(8, 30),
    destinationDelaySeconds: 0,
    observedArrival: at(8, 30),
    cancelled: false,
    skipped: false,
    ...overrides,
  };
}

describe("percentileOf", () => {
  it("uses nearest-rank rather than inventing precision from few samples", () => {
    expect(percentileOf([10, 20, 30, 40], 90)).toBe(40);
    expect(percentileOf([10, 20, 30, 40], 50)).toBe(20);
  });

  it("returns null with nothing to rank", () => {
    expect(percentileOf([], 90)).toBeNull();
    expect(medianOf([])).toBeNull();
  });
});

describe("formatDepartureLabel", () => {
  it("renders timetable slots the way a rider says them", () => {
    expect(formatDepartureLabel(7 * 60 + 42)).toBe("7:42 AM");
    expect(formatDepartureLabel(12 * 60)).toBe("12:00 PM");
    expect(formatDepartureLabel(0)).toBe("12:00 AM");
    expect(formatDepartureLabel(17 * 60 + 5)).toBe("5:05 PM");
  });
});

describe("buildCommuteDepartures", () => {
  it("groups by timetable slot across days, not by trip id", () => {
    // The same 7:42 on three days is one departure a commuter plans around.
    const journeys = [0, 1, 2].map((d) =>
      journey({ tripId: `T-${d}`, serviceDate: `2026-08-1${3 + d}`, scheduledDeparture: at(7, 42, d) }),
    );
    const result = buildCommuteDepartures(journeys);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: "7:42 AM", observations: 3 });
  });

  it("judges lateness at the destination, not at the origin", () => {
    // Left on time, arrived 10 minutes late: not a punctual journey.
    const result = buildCommuteDepartures([journey({ originDelaySeconds: 0, destinationDelaySeconds: 600 })]);
    expect(result[0]?.onTimePercent).toBe(0);
    expect(result[0]?.avgArrivalDelaySeconds).toBe(600);
  });

  it("counts a cancellation as an observation but not as a delay", () => {
    const result = buildCommuteDepartures([
      journey({ cancelled: true, destinationDelaySeconds: null, observedArrival: null }),
      journey({ destinationDelaySeconds: 0 }),
    ]);
    expect(result[0]).toMatchObject({ observations: 2, cancellations: 1, onTimePercent: 100 });
  });

  it("flags a thin sample rather than publishing a confident rate", () => {
    const result = buildCommuteDepartures([journey()]);
    expect(result[0]?.lowSample).toBe(true);
  });

  it("orders departures through the day", () => {
    const result = buildCommuteDepartures([
      journey({ scheduledDeparture: at(17, 5) }),
      journey({ scheduledDeparture: at(6, 15) }),
      journey({ scheduledDeparture: at(7, 42) }),
    ]);
    expect(result.map((d) => d.label)).toEqual(["6:15 AM", "7:42 AM", "5:05 PM"]);
  });

  it("skips journeys with no timetabled departure to group by", () => {
    expect(buildCommuteDepartures([journey({ scheduledDeparture: null })])).toEqual([]);
  });
});

describe("rankDepartures", () => {
  const solid = (label: string, otp: number): Parameters<typeof rankDepartures>[0][number] => ({
    departureMinutes: 1,
    label,
    lineName: "NEC",
    scheduledMinutes: 48,
    observations: 60,
    cancellations: 0,
    onTimePercent: otp,
    avgArrivalDelaySeconds: 60,
    p90ArrivalDelaySeconds: 300,
    lowSample: false,
  });

  it("names the best and worst departures", () => {
    const { mostReliable, leastReliable } = rankDepartures([solid("A", 95), solid("B", 60), solid("C", 80)]);
    expect(mostReliable?.label).toBe("A");
    expect(leastReliable?.label).toBe("B");
  });

  // Naming a "best train" off three runs would be worse than naming none.
  it("refuses to rank when only thin samples exist", () => {
    const thin = { ...solid("A", 100), lowSample: true };
    expect(rankDepartures([thin, { ...thin, label: "B" }])).toEqual({ mostReliable: null, leastReliable: null });
  });

  it("refuses to rank a single departure against itself", () => {
    expect(rankDepartures([solid("A", 95)])).toEqual({ mostReliable: null, leastReliable: null });
  });
});

describe("departureMinutes", () => {
  it("converts an instant to minutes after NJT-local midnight", () => {
    expect(departureMinutes(at(7, 42))).toBe(7 * 60 + 42);
  });
});
