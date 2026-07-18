import { describe, expect, it } from "vitest";
import { monthIndex, monthKey } from "../src/month";

describe("monthIndex", () => {
  it("encodes a month as year*12 + (month-1)", () => {
    expect(monthIndex(2024, 1)).toBe(2024 * 12);
    expect(monthIndex(2024, 12)).toBe(2024 * 12 + 11);
  });

  it("is monotonic in calendar order", () => {
    expect(monthIndex(2024, 12)).toBeLessThan(monthIndex(2025, 1));
    expect(monthIndex(2025, 1)).toBe(monthIndex(2024, 12) + 1);
  });
});

describe("monthKey", () => {
  it("joins year and unpadded month", () => {
    expect(monthKey(2024, 1)).toBe("2024-1");
    expect(monthKey(2024, 12)).toBe("2024-12");
  });
});
