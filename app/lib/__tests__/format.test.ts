import { describe, expect, it } from "vitest";
import {
  officialPeriodLabel,
  formatDelaySeconds,
  formatDelayShort,
  formatInt,
  formatMonth,
  formatPercent,
  formatShortDate,
  formatTimestamp,
  humanizeEffect,
} from "../format";

describe("formatDelaySeconds", () => {
  it("formats late, early, on-time, and unknown", () => {
    expect(formatDelaySeconds(150)).toBe("2m 30s late");
    expect(formatDelaySeconds(120)).toBe("2m late");
    expect(formatDelaySeconds(-90)).toBe("1m 30s early");
    expect(formatDelaySeconds(10)).toBe("on time");
    expect(formatDelaySeconds(null)).toBe("—");
  });

  it("rounds fractional seconds before splitting (no '1m 60s')", () => {
    // 119.6 rounds to 120s → "2m", never "1m 60s".
    expect(formatDelaySeconds(119.6)).toBe("2m late");
  });
});

describe("formatDelayShort", () => {
  it("formats compact late/early/on-time/unknown", () => {
    expect(formatDelayShort(150)).toBe("2m 30s");
    expect(formatDelayShort(-90)).toBe("−1m 30s");
    expect(formatDelayShort(10)).toBe("0");
    expect(formatDelayShort(null)).toBe("—");
  });

  it("rounds fractional seconds before splitting (no '1m 60s')", () => {
    expect(formatDelayShort(119.6)).toBe("2m");
  });
});

describe("formatInt", () => {
  it("groups thousands and handles unknown", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(null)).toBe("—");
  });
});

describe("formatTimestamp", () => {
  it("returns 'never' for unknown and a string otherwise", () => {
    expect(formatTimestamp(null)).toBe("never");
    expect(formatTimestamp(undefined)).toBe("never");
    const rendered = formatTimestamp(Date.UTC(2025, 6, 15, 16, 0, 0));
    expect(typeof rendered).toBe("string");
    expect(rendered).not.toBe("never");
  });
});

describe("date + misc formatters", () => {
  it("formats dates and percentages", () => {
    expect(formatShortDate("2025-07-15")).toBe("Jul 15");
    expect(formatMonth("2025-07-15")).toBe("Jul 2025");
    expect(formatPercent(88.5)).toBe("88.5%");
    expect(formatPercent(null)).toBe("—");
    expect(humanizeEffect("reduced_service")).toBe("Reduced service");
  });

  it("returns the input unchanged when the date is malformed", () => {
    expect(formatShortDate("bad")).toBe("bad");
  });
});

describe("officialPeriodLabel", () => {
  it("states the period even when the figures do cover the requested range", () => {
    // The old caption stayed silent here, which left an unlabelled row of
    // NJT tiles sitting beside live measurements with nothing to tell them
    // apart — and said nothing at all when the overlap was only partial.
    expect(officialPeriodLabel({ fromMonth: "2026-04", toMonth: "2026-05", outsideRequestedRange: false })).toBe(
      "Apr 2026 – May 2026",
    );
    expect(officialPeriodLabel({ fromMonth: "2026-05", toMonth: "2026-05", outsideRequestedRange: false })).toBe(
      "May 2026",
    );
  });

  it("says a substituted month predates the window, without disowning the rest of the page", () => {
    const label = officialPeriodLabel({ fromMonth: "2026-05", toMonth: "2026-05", outsideRequestedRange: true });
    expect(label).toBe("May 2026 — NJT's most recent published month, before your selected window");
    // It describes NJT's figures only. "this period" previously read as a
    // verdict on everything on screen, including the live measurements.
    expect(label).not.toMatch(/this period/iu);
  });

  it("renders a multi-month span", () => {
    expect(officialPeriodLabel({ fromMonth: "2026-03", toMonth: "2026-05", outsideRequestedRange: true })).toContain(
      "Mar 2026 – May 2026",
    );
  });

  it("has nothing to say when nothing has ever been published", () => {
    expect(officialPeriodLabel(null)).toBeNull();
    expect(officialPeriodLabel(undefined)).toBeNull();
  });
});
