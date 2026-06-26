import { describe, expect, it } from "vitest";
import { barLayout, heatColor, linePath, linePoints, niceMax } from "../charts";

describe("niceMax", () => {
  it("rounds up to 1/2/5 x 10^n", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(140)).toBe(200);
  });
});

describe("barLayout", () => {
  it("scales bar heights to the max and lays them across the width", () => {
    const bars = barLayout([5, 10], { width: 100, height: 50, gap: 0, maxValue: 10 });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ x: 0, width: 50, height: 25, y: 25 }); // 5/10 of 50
    expect(bars[1]).toMatchObject({ x: 50, width: 50, height: 50, y: 0 });
  });
});

describe("linePoints / linePath", () => {
  it("spaces points and builds an SVG path", () => {
    const points = linePoints([0, 10], { width: 100, height: 50, minValue: 0, maxValue: 10 });
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[1]).toEqual({ x: 100, y: 0 });
    expect(linePath(points)).toBe("M0.00,50.00 L100.00,0.00");
  });
});

describe("heatColor", () => {
  it("interpolates from cool to hot", () => {
    expect(heatColor(0, 100)).toBe("rgb(225, 240, 252)");
    expect(heatColor(100, 100)).toBe("rgb(197, 48, 48)");
  });
});
