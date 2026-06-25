import type { TripStopEvent } from "@njt/shared";
import { describe, expect, it } from "vitest";
import { computeAggregates } from "../src/aggregator";

const DATE = "2025-07-15";
const TERM = Math.floor(Date.UTC(2025, 6, 15, 12, 0, 0) / 1000); // 08:00 EDT -> hour 8, Tue (dow 2)

function ev(o: Partial<TripStopEvent>): TripStopEvent {
  return {
    tripId: "A",
    routeId: "NE",
    lineName: "Northeast Corridor Line",
    stopId: "NWK",
    stopName: "Newark Penn",
    stopSequence: 1,
    direction: "inbound",
    serviceDate: DATE,
    scheduledArrival: null,
    scheduledDeparture: null,
    observedArrival: null,
    delaySeconds: null,
    stopSkipped: false,
    tripCancelled: false,
    gtfsStaticVersion: "v1",
    ingestedAtMs: 0,
    ...o,
  };
}

describe("computeAggregates — OTP / distribution / heatmap / station", () => {
  const events: TripStopEvent[] = [
    ev({ tripId: "A", stopId: "NWK", stopSequence: 1, delaySeconds: 60, scheduledArrival: TERM - 1200 }),
    ev({ tripId: "A", stopId: "NYP", stopName: "New York Penn", stopSequence: 2, delaySeconds: 700, scheduledArrival: TERM }),
    ev({ tripId: "B", stopId: "NWK", stopSequence: 1, delaySeconds: 200, scheduledArrival: TERM - 1200 }),
    ev({ tripId: "B", stopId: "NYP", stopName: "New York Penn", stopSequence: 2, delaySeconds: 100, scheduledArrival: TERM }),
    ev({ tripId: "C", routeId: "RV", lineName: "Raritan Valley Line", stopId: "NWK", stopSequence: 1, tripCancelled: true }),
    ev({ tripId: "C", routeId: "RV", lineName: "Raritan Valley Line", stopId: "XYZ", stopName: "X", stopSequence: 2, tripCancelled: true }),
  ];
  const bundle = computeAggregates(events, DATE);

  it("rolls up system OTP using terminal delays", () => {
    const sys = bundle.otp.find((r) => r.scope === "system" && r.direction === "all");
    expect(sys).toMatchObject({ tripsOperated: 2, tripsCancelled: 1, sumDelaySeconds: 800 });
    expect(sys?.onTimeCounts["300"]).toBe(1); // only B (100s)
    expect(sys?.onTimeCounts["900"]).toBe(2); // A (700) and B (100)
  });

  it("keeps a per-line, per-direction OTP row", () => {
    expect(bundle.otp.find((r) => r.scope === "line" && r.scopeId === "NE" && r.direction === "inbound")?.tripsOperated).toBe(2);
  });

  it("builds the system delay distribution", () => {
    const dist = bundle.distribution.find((r) => r.scope === "system");
    expect(dist?.counts["0-5 min"]).toBe(1);
    expect(dist?.counts["10-15 min"]).toBe(1);
  });

  it("buckets heatmap by the terminal's scheduled hour and weekday", () => {
    const hour = bundle.heatmap.find((h) => h.scope === "system" && h.type === "hour_of_day" && h.bucket === 8);
    expect(hour).toMatchObject({ sumDelaySeconds: 800, observations: 2 });
    expect(bundle.heatmap.find((h) => h.type === "day_of_week" && h.bucket === 2)?.observations).toBe(2);
  });

  it("computes station delay amplification at NWK", () => {
    const nwk = bundle.stationDaily.find((s) => s.stopId === "NWK" && s.lineName === "Northeast Corridor Line");
    // both A and B arrive within 5 min; only A then runs late at the next stop
    expect(nwk).toMatchObject({ observations: 2, sumArrivalDelaySeconds: 260, arrivedWithin5Min: 2, departedLateAfterOnTimeArrival: 1 });
  });

  it("records a terminal-delay row per trip and skips cancelled delay", () => {
    expect(bundle.trips.find((t) => t.tripId === "A")?.terminalDelaySeconds).toBe(700);
    expect(bundle.trips.find((t) => t.tripId === "C")?.terminalDelaySeconds).toBeNull();
  });
});

describe("computeAggregates — connections", () => {
  const events: TripStopEvent[] = [
    ev({ tripId: "A", stopId: "NWK", stopSequence: 1, scheduledArrival: 1000, observedArrival: 1060, scheduledDeparture: 1060 }),
    ev({ tripId: "A", stopId: "NYP", stopSequence: 2, scheduledArrival: 3000, observedArrival: 3060 }),
    ev({ tripId: "B", stopId: "NWK", stopSequence: 1, scheduledArrival: 1200, observedArrival: 1400, scheduledDeparture: 1500 }),
    ev({ tripId: "B", stopId: "NYP", stopSequence: 2, scheduledArrival: 3200, observedArrival: 3260 }),
  ];

  it("pairs an inbound arrival with a feasible outbound departure", () => {
    const { connections } = computeAggregates(events, DATE);
    const conn = connections.find((c) => c.inboundTripId === "A" && c.transferStopId === "NWK" && c.outboundTripId === "B");
    expect(conn).toMatchObject({ observations: 1, successes: 1 });
    // The reverse pairing (B->A) is infeasible: A departs before B arrives.
    expect(connections.some((c) => c.inboundTripId === "B" && c.outboundTripId === "A")).toBe(false);
  });
});
