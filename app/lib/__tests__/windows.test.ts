import { describe, expect, it } from "vitest";
import { windowToRange } from "../windows";

describe("windowToRange", () => {
  it("builds a trailing window ending today", () => {
    expect(windowToRange(7, "2025-07-15")).toEqual({ from: "2025-07-09", to: "2025-07-15" });
    expect(windowToRange(30, "2025-07-30")).toEqual({ from: "2025-07-01", to: "2025-07-30" });
  });
});
