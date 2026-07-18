import { describe, expect, it } from "vitest";
import {
  DELAY_BUCKETS,
  OTP_FAIR_THRESHOLD_PERCENT,
  OTP_GOOD_THRESHOLD_PERCENT,
  OTP_STRICT_THRESHOLD_SECONDS,
  TRANSFER_BUFFER_DEFAULT_SECONDS,
  TRANSFER_WINDOW_DEFAULT_SECONDS,
} from "../src/constants";

describe("shared threshold constants", () => {
  it("pins the strict OTP threshold at 5 minutes", () => {
    expect(OTP_STRICT_THRESHOLD_SECONDS).toBe(300);
  });

  it("pins the OTP color bands", () => {
    expect(OTP_GOOD_THRESHOLD_PERCENT).toBe(90);
    expect(OTP_FAIR_THRESHOLD_PERCENT).toBe(75);
    expect(OTP_GOOD_THRESHOLD_PERCENT).toBeGreaterThan(OTP_FAIR_THRESHOLD_PERCENT);
  });

  it("pins the connection transfer defaults", () => {
    expect(TRANSFER_WINDOW_DEFAULT_SECONDS).toBe(1800);
    expect(TRANSFER_BUFFER_DEFAULT_SECONDS).toBe(0);
  });
});

describe("DELAY_BUCKETS shortLabel", () => {
  it("gives every bucket a non-empty short label", () => {
    for (const b of DELAY_BUCKETS) {
      expect(b.shortLabel.length).toBeGreaterThan(0);
    }
  });

  it("keeps short labels unique (one per bucket)", () => {
    const shorts = DELAY_BUCKETS.map((b) => b.shortLabel);
    expect(new Set(shorts).size).toBe(DELAY_BUCKETS.length);
  });
});
