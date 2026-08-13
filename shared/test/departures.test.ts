import { describe, expect, it } from "vitest";
import { departureStatus, formatCountdown, minutesUntil } from "../src/departures";

const base = { delaySeconds: 0, tripCancelled: false, stopSkipped: false };

describe("departureStatus", () => {
  it("ranks cancellation above every other signal", () => {
    // A cancelled trip can still carry a stale delay reading; it is not "late".
    expect(departureStatus({ ...base, delaySeconds: 600, tripCancelled: true })).toBe("cancelled");
  });

  it("reports a skipped stop distinctly from a cancelled trip", () => {
    expect(departureStatus({ ...base, stopSkipped: true })).toBe("skipped");
  });

  it("distinguishes no-prediction from on-time", () => {
    // Null delay means the feed isn't tracking the trip — not that it's punctual.
    expect(departureStatus({ ...base, delaySeconds: null })).toBe("scheduled");
    expect(departureStatus({ ...base, delaySeconds: 0 })).toBe("on_time");
  });

  it("uses a rider-scale late threshold, not NJT's 6 minutes", () => {
    expect(departureStatus({ ...base, delaySeconds: 120 })).toBe("on_time");
    expect(departureStatus({ ...base, delaySeconds: 121 })).toBe("late");
    // Would still be "on time" by NJT's official 360s rule.
    expect(departureStatus({ ...base, delaySeconds: 300 })).toBe("late");
  });

  it("flags a meaningfully early train", () => {
    expect(departureStatus({ ...base, delaySeconds: -60 })).toBe("on_time");
    expect(departureStatus({ ...base, delaySeconds: -61 })).toBe("early");
  });
});

describe("minutesUntil", () => {
  const now = 1_700_000_000_000; // epoch ms
  const nowSec = 1_700_000_000;

  it("rounds down so the board never over-promises", () => {
    expect(minutesUntil(nowSec + 119, now)).toBe(1);
    expect(minutesUntil(nowSec + 120, now)).toBe(2);
  });

  it("goes negative once a departure is due", () => {
    expect(minutesUntil(nowSec - 61, now)).toBe(-2);
  });

  it("returns null when there is nothing to count to", () => {
    expect(minutesUntil(null, now)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("renders the board's countdown column", () => {
    expect(formatCountdown(null)).toBe("—");
    expect(formatCountdown(-1)).toBe("departed");
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(12)).toBe("12 min");
  });
});
