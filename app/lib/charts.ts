/**
 * Pure chart geometry — scales, bar/line layout, smoothing, axis ticks, gauge
 * arcs, and heat colors. Kept free of React Native so it can be unit-tested
 * directly; the SVG components render these results.
 */

/** Round a value up to a "nice" axis maximum (1, 2, 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const normalized = value / pow;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * pow;
}

/** Evenly spaced tick values from 0..max inclusive (count = number of gaps). */
export function axisTicks(max: number, count = 4): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

export interface BarLayoutOptions {
  width: number;
  height: number;
  gap?: number;
  maxValue?: number;
}

/** Lay out equal-width bars across `width`, scaled to `maxValue` (or a nice max). */
export function barLayout(values: readonly number[], options: BarLayoutOptions): Bar[] {
  const { width, height } = options;
  const gap = options.gap ?? 4;
  const max = options.maxValue ?? niceMax(Math.max(0, ...values));
  const count = values.length || 1;
  const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
  return values.map((value, i) => {
    const h = max > 0 ? Math.max(0, (value / max) * height) : 0;
    return { x: i * (barWidth + gap), y: height - h, width: barWidth, height: h, value };
  });
}

export interface Point {
  x: number;
  y: number;
}

export interface LineLayoutOptions {
  width: number;
  height: number;
  minValue?: number;
  maxValue?: number;
}

/** Evenly space `values` across `width`, scaling y into `height` (y grows down). */
export function linePoints(values: readonly number[], options: LineLayoutOptions): Point[] {
  const { width, height } = options;
  const min = options.minValue ?? 0;
  const max = options.maxValue ?? niceMax(Math.max(0, ...values));
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, i) => ({
    x: i * step,
    y: height - ((value - min) / span) * height,
  }));
}

/** SVG path `d` connecting points with straight segments. */
export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/**
 * Smooth SVG path through points using a Catmull-Rom → cubic-bézier conversion.
 * Gives charts a polished curve without overshooting wildly. Falls back to a
 * straight path for < 3 points.
 */
export function smoothPath(points: readonly Point[], tension = 0.5): string {
  if (points.length < 3) return linePath(points);
  const p = points;
  let d = `M${p[0]!.x.toFixed(2)},${p[0]!.y.toFixed(2)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const t = tension / 3;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Closed area path under a line (line → down to baseline → back to start). */
export function areaPath(points: readonly Point[], baselineY: number, smooth = true): string {
  if (points.length === 0) return "";
  const top = smooth ? smoothPath(points) : linePath(points);
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return `${top} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Reliability heat color for a delay value: low delay → green, mid → amber,
 * high → red. `t = value / max`. Tuned to read on the dark theme with dark
 * text on top. Returns an `rgb(...)` string.
 */
export function heatColor(value: number, max: number): string {
  const t = clamp01(max > 0 ? value / max : 0);
  const green = [52, 211, 153];
  const amber = [251, 191, 36];
  const red = [248, 113, 113];
  const [from, to, local] = t < 0.5 ? [green, amber, t / 0.5] : [amber, red, (t - 0.5) / 0.5];
  return `rgb(${lerpChannel(from[0]!, to[0]!, local)}, ${lerpChannel(from[1]!, to[1]!, local)}, ${lerpChannel(from[2]!, to[2]!, local)})`;
}

/** Convert a polar coordinate (degrees, 0° = 12 o'clock, clockwise) to x/y. */
export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * SVG arc path between two angles (degrees) on a circle. Used for the radial
 * OTP gauge. Sweeps clockwise.
 */
export function gaugeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
