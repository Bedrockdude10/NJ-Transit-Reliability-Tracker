import { describe, expect, it } from "vitest";
import { areaPath, axisTicks, barLayout, gaugeArc, heatColor, linePath, linePoints, niceMax, polarToCartesian, smoothPath } from "../charts";

describe("niceMax", () => {
  it("rounds up to 1/2/5 x 10^n", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(140)).toBe(200);
  });

  it("guards non-positive input to 1", () => {
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(-0.001)).toBe(1);
  });
});

describe("barLayout", () => {
  it("scales bar heights to the max and lays them across the width", () => {
    const bars = barLayout([5, 10], { width: 100, height: 50, gap: 0, maxValue: 10 });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ x: 0, width: 50, height: 25, y: 25 }); // 5/10 of 50
    expect(bars[1]).toMatchObject({ x: 50, width: 50, height: 50, y: 0 });
  });

  it("applies the default gap (4) and derives a nice max when unspecified", () => {
    const bars = barLayout([10, 20], { width: 100, height: 50 });
    // gap defaults to 4 → barWidth = (100 - 4) / 2 = 48; max = niceMax(20) = 20.
    expect(bars[0]).toMatchObject({ x: 0, width: 48, height: 25, y: 25 });
    expect(bars[1]).toMatchObject({ x: 52, width: 48, height: 50, y: 0 });
  });

  it("emits zero-height bars when max is non-positive", () => {
    const bars = barLayout([5, 8], { width: 100, height: 50, maxValue: 0 });
    expect(bars[0]).toMatchObject({ height: 0, y: 50 });
    expect(bars[1]).toMatchObject({ height: 0, y: 50 });
  });
});

describe("linePoints / linePath", () => {
  it("spaces points and builds an SVG path", () => {
    const points = linePoints([0, 10], { width: 100, height: 50, minValue: 0, maxValue: 10 });
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[1]).toEqual({ x: 100, y: 0 });
    expect(linePath(points)).toBe("M0.00,50.00 L100.00,0.00");
  });

  it("places a single value at x=0 (step is 0)", () => {
    const points = linePoints([5], { width: 100, height: 50 });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 0, y: 0 }); // 5 of niceMax(5)=5 → full height
  });
});

describe("heatColor", () => {
  it("ramps green (low delay) → amber → red (high delay)", () => {
    expect(heatColor(0, 100)).toBe("rgb(52, 211, 153)"); // green
    expect(heatColor(50, 100)).toBe("rgb(251, 191, 36)"); // amber at the midpoint
    expect(heatColor(100, 100)).toBe("rgb(248, 113, 113)"); // red
  });

  it("clamps values above max to red", () => {
    expect(heatColor(150, 100)).toBe("rgb(248, 113, 113)");
  });

  it("treats a non-positive max as green (t=0)", () => {
    expect(heatColor(5, 0)).toBe("rgb(52, 211, 153)");
  });
});

describe("polarToCartesian", () => {
  it("returns numeric x/y for a 0° (12 o'clock) point", () => {
    const p = polarToCartesian(50, 50, 40, 0);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(10, 6);
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
