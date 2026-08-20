import { describe, expect, it } from "vitest";
import { CERTIFICATE_BANDS, PEAK_WINDOWS } from "../src/constants";
import {
  CERTIFICATE_THRESHOLD_SECONDS,
  bandForHour,
  bandHours,
  bandLabel,
  isCertificateIssued,
  orderedBands,
} from "../src/certificate";

describe("the band a local hour falls in", () => {
  it("puts the small hours before the morning peak", () => {
    expect(bandForHour(0)).toBe("early");
    expect(bandForHour(5)).toBe("early");
  });

  it("opens the morning peak on its first hour and closes it before its last", () => {
    expect(bandForHour(PEAK_WINDOWS.amPeakStartHour)).toBe("am_peak");
    expect(bandForHour(PEAK_WINDOWS.amPeakEndHour - 1)).toBe("am_peak");
    expect(bandForHour(PEAK_WINDOWS.amPeakEndHour)).toBe("midday");
  });

  it("opens the evening peak on its first hour and closes it before its last", () => {
    expect(bandForHour(PEAK_WINDOWS.pmPeakStartHour)).toBe("pm_peak");
    expect(bandForHour(PEAK_WINDOWS.pmPeakEndHour - 1)).toBe("pm_peak");
    expect(bandForHour(PEAK_WINDOWS.pmPeakEndHour)).toBe("evening");
  });

  it("assigns every hour of the day to exactly one band", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => bandForHour(hour));
    expect(hours).toHaveLength(24);
    expect(new Set(hours).size).toBe(CERTIFICATE_BANDS.length);
  });

  it("covers the clock with no gap and no overlap", () => {
    const spans = orderedBands().map(bandHours);
    expect(spans[0]?.startHour).toBe(0);
    expect(spans.at(-1)?.endHour).toBe(24);
    for (const [index, span] of spans.entries()) {
      if (index === 0) continue;
      expect(span.startHour).toBe(spans[index - 1]?.endHour);
    }
  });

  it("agrees with its own hour spans on which band an hour belongs to", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const span = bandHours(bandForHour(hour));
      expect(hour).toBeGreaterThanOrEqual(span.startHour);
      expect(hour).toBeLessThan(span.endHour);
    }
  });

  it("labels every band, so no screen has to render a raw key", () => {
    for (const band of orderedBands()) {
      expect(bandLabel(band)).not.toBe("");
    }
  });
});

describe("whether a band's delay warrants a certificate", () => {
  it("issues at exactly the threshold, because JR East's rule is five minutes or more", () => {
    expect(isCertificateIssued(CERTIFICATE_THRESHOLD_SECONDS)).toBe(true);
    expect(isCertificateIssued(CERTIFICATE_THRESHOLD_SECONDS - 1)).toBe(false);
  });

  it("does not issue for a band that ran early", () => {
    expect(isCertificateIssued(-120)).toBe(false);
  });

  it("uses five minutes, matching the strict OTP threshold this project reports", () => {
    expect(CERTIFICATE_THRESHOLD_SECONDS).toBe(300);
  });
});
