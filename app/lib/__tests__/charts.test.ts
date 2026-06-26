import { describe, expect, it } from "vitest";
import { areaPath, axisTicks, barLayout, gaugeArc, heatColor, linePath, linePoints, niceMax, smoothPath } from "../charts";

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
  it("ramps green (low delay) → amber → red (high delay)", () => {
    expect(heatColor(0, 100)).toBe("rgb(52, 211, 153)"); // green
    expect(heatColor(50, 100)).toBe("rgb(251, 191, 36)"); // amber at the midpoint
    expect(heatColor(100, 100)).toBe("rgb(248, 113, 113)"); // red
  });
});

describe("axisTicks", () => {
  it("returns evenly spaced ticks from 0 to max", () => {
    expect(axisTicks(100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(60, 3)).toEqual([0, 20, 40, 60]);
  });
});

describe("smoothPath", () => {
  it("falls back to a straight path under 3 points", () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe("M0.00,0.00 L10.00,10.00");
  });

  it("emits cubic béziers for 3+ points", () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(d.startsWith("M0.00,0.00")).toBe(true);
    expect(d).toContain("C");
  });
});

describe("areaPath", () => {
  it("closes the line down to the baseline", () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 100, y: 0 }], 50, false);
    expect(d).toBe("M0.00,10.00 L100.00,0.00 L100.00,50.00 L0.00,50.00 Z");
  });
});

describe("gaugeArc", () => {
  it("builds an SVG arc command", () => {
    const d = gaugeArc(50, 50, 40, 0, 90);
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain(" A 40 40 ");
  });
});
