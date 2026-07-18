import { describe, expect, it } from "vitest";
import {
  applyZoom,
  buildProjection,
  clampView,
  distToSegment,
  MAP_MAX_SCALE,
  type LonLat,
  type ProjectableStation,
  type ViewBox,
} from "../map-projection";

describe("distToSegment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("is the perpendicular distance when the foot lands on the segment", () => {
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3);
  });

  it("clamps to the endpoints when the projection falls outside", () => {
    expect(distToSegment({ x: -4, y: 0 }, a, b)).toBeCloseTo(4); // before a
    expect(distToSegment({ x: 14, y: 0 }, a, b)).toBeCloseTo(4); // after b
  });

  it("handles a degenerate zero-length segment as distance to the point", () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5);
  });
});

describe("clampView", () => {
  it("snaps back to the origin at (or below) 1×", () => {
    expect(clampView({ scale: 1, tx: 40, ty: -20 }, 100, 100)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(clampView({ scale: 0.5, tx: 5, ty: 5 }, 100, 100)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("clamps the max scale and keeps content covering the viewport", () => {
    const v = clampView({ scale: 100, tx: 1000, ty: 1000 }, 200, 200);
    expect(v.scale).toBe(MAP_MAX_SCALE);
    // translations are pinned into [w*(1-scale), 0]
    expect(v.tx).toBe(0);
    expect(v.ty).toBe(0);
    const v2 = clampView({ scale: 2, tx: -9999, ty: -9999 }, 200, 200);
    expect(v2.tx).toBe(200 * (1 - 2));
    expect(v2.ty).toBe(200 * (1 - 2));
  });
});

describe("applyZoom", () => {
  it("keeps the focal point fixed while zooming in", () => {
    const start: ViewBox = { scale: 1, tx: 0, ty: 0 };
    const focal = { x: 50, y: 50 };
    const zoomed = applyZoom(start, focal, 2, 200, 200);
    expect(zoomed.scale).toBe(2);
    // The base coord under the focal point maps back to the same screen point.
    const baseX = (focal.x - zoomed.tx) / zoomed.scale;
    const baseY = (focal.y - zoomed.ty) / zoomed.scale;
    expect(zoomed.tx + baseX * zoomed.scale).toBeCloseTo(focal.x);
    expect(zoomed.ty + baseY * zoomed.scale).toBeCloseTo(focal.y);
  });

  it("never exceeds the max scale", () => {
    const v = applyZoom({ scale: MAP_MAX_SCALE, tx: 0, ty: 0 }, { x: 0, y: 0 }, 4, 200, 200);
    expect(v.scale).toBe(MAP_MAX_SCALE);
  });
});

describe("buildProjection", () => {
  const outline: LonLat[] = [
    [-75, 41],
    [-74, 41],
    [-74, 40],
    [-75, 40],
  ];
  const stations: ProjectableStation[] = [
    { stopId: "A", lat: 40, lon: -75 },
    { stopId: "B", lat: 41, lon: -74 },
  ];

  it("projects every station into the viewport with y inverted (north is up)", () => {
    const { coord } = buildProjection(stations, outline, 200, 200);
    const a = coord.get("A")!;
    const b = coord.get("B")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Station B is further north (higher lat) so it has a smaller y.
    expect(b.y).toBeLessThan(a.y);
    // Station B is further east (higher lon) so it has a larger x.
    expect(b.x).toBeGreaterThan(a.x);
    // Everything stays within the padded box.
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(200);
    }
  });

  it("emits a closed outline path starting with a move command", () => {
    const { outlineD } = buildProjection(stations, outline, 200, 200);
    expect(outlineD.startsWith("M")).toBe(true);
    expect(outlineD.endsWith("Z")).toBe(true);
    // One command per outline vertex plus the closing Z.
    expect(outlineD.split(" ").filter((t) => t.startsWith("M") || t.startsWith("L")).length).toBe(outline.length);
  });

  it("does not divide by zero when all points coincide", () => {
    const degenerate: ProjectableStation[] = [{ stopId: "X", lat: 40, lon: -74 }];
    const { coord } = buildProjection(degenerate, [[-74, 40]], 200, 200);
    const p = coord.get("X")!;
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});
