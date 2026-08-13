import type { AlertFrequencyResponse } from "@njt/shared";
import { describe, expect, it } from "vitest";
import { availableEffects, isMeaningfulEffect } from "../alerts";

function freq(byLine: AlertFrequencyResponse["byLine"]): AlertFrequencyResponse {
  return { from: "2026-05-01", to: "2026-08-01", byLine };
}

describe("availableEffects", () => {
  it("returns nothing while the feed only reports unknown effects", () => {
    // NJT's live behaviour: every alert decodes to "unknown", so a filter row
    // would offer chips that match nothing.
    expect(availableEffects(freq([{ lineName: "NEC", counts: { unknown: 50 }, total: 50 }]))).toEqual([]);
  });

  it("lists real effects most frequent first, ignoring unknown", () => {
    const result = availableEffects(
      freq([
        { lineName: "NEC", counts: { delay: 5, detour: 1, unknown: 99 }, total: 105 },
        { lineName: "NJCL", counts: { delay: 2, detour: 4 }, total: 6 },
      ]),
    );
    expect(result).toEqual(["delay", "detour"]); // delay 7, detour 5
  });

  it("breaks frequency ties alphabetically for a stable chip order", () => {
    expect(availableEffects(freq([{ lineName: "NEC", counts: { detour: 3, delay: 3 }, total: 6 }]))).toEqual([
      "delay",
      "detour",
    ]);
  });

  it("handles the pre-load state", () => {
    expect(availableEffects(null)).toEqual([]);
    expect(availableEffects(undefined)).toEqual([]);
    expect(availableEffects(freq([]))).toEqual([]);
  });
});

describe("isMeaningfulEffect", () => {
  it("treats unknown and empty as not worth showing", () => {
    expect(isMeaningfulEffect("unknown")).toBe(false);
    expect(isMeaningfulEffect("")).toBe(false);
    expect(isMeaningfulEffect(null)).toBe(false);
    expect(isMeaningfulEffect("delay")).toBe(true);
  });
});
