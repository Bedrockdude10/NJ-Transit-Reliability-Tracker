import { describe, expect, it } from "vitest";
import { todayString, windowToRange, WINDOWS } from "../windows";

describe("todayString", () => {
  it("resolves the ET calendar date for a fixed instant", () => {
    // 2025-07-16T03:00:00Z is still 23:00 EDT on the 15th.
    const nowMs = Date.UTC(2025, 6, 16, 3, 0, 0);
    expect(todayString(nowMs)).toBe("2025-07-15");
  });
});

describe("windowToRange", () => {
  it("builds a trailing window ending today", () => {
    expect(windowToRange(7, "2025-07-15")).toEqual({ from: "2025-07-09", to: "2025-07-15" });
    expect(windowToRange(30, "2025-07-30")).toEqual({ from: "2025-07-01", to: "2025-07-30" });
  });

  it("covers the 'All' preset (days=3653) reaching ~10 years back", () => {
    const all = WINDOWS.find((w) => w.key === "all");
    expect(all?.days).toBe(3653);
    expect(windowToRange(3653, "2025-07-15")).toEqual({ from: "2015-07-16", to: "2025-07-15" });
  });
});
