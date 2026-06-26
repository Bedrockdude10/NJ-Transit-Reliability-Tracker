/**
 * Pure chart geometry — scales, bar/line layout, and heatmap colors. Kept
 * free of React Native so it can be unit-tested directly; the SVG components
 * render these results.
 */

/** Round a value up to a "nice" axis maximum (1, 2, 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const normalized = value / pow;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * pow;
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

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Heatmap color from cool (low delay) to hot (high delay). `t` is normalized
 * 0..1; returns an `rgb(...)` string.
 */
export function heatColor(value: number, max: number): string {
  const t = clamp01(max > 0 ? value / max : 0);
  const cool = [225, 240, 252];
  const hot = [197, 48, 48];
  const channel = (i: number) => Math.round((cool[i] ?? 0) + ((hot[i] ?? 0) - (cool[i] ?? 0)) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}
