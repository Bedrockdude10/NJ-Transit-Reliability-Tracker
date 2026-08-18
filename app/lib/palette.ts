/**
 * Concrete palettes, the source of truth for theming. Keys here MUST match
 * `theme.colors`, which references them as `var(--njt-<key>)`.
 */

export type ColorKey =
  | "background" | "surface" | "surfaceAlt" | "surfaceHover" | "border" | "borderStrong"
  | "text" | "textMuted" | "textFaint" | "gridLine" | "track"
  | "accent" | "accentSoft" | "njt" | "njtSoft"
  | "good" | "goodSoft" | "warn" | "warnSoft" | "bad" | "badSoft";

export type Palette = Record<ColorKey, string>;

export const DARK: Palette = {
  background: "#0a0f1d",
  surface: "#141b2d",
  surfaceAlt: "#1c2540",
  surfaceHover: "#243153",
  border: "#283455",
  borderStrong: "#3a4a73",
  text: "#f3f6fc",
  textMuted: "#9fb0cc",
  textFaint: "#6b7c9c",
  gridLine: "#212c49",
  track: "#1c2540",
  accent: "#3dc1ff",
  accentSoft: "rgba(61,193,255,0.14)",
  njt: "#facc15",
  njtSoft: "rgba(250,204,21,0.16)",
  good: "#34d399",
  goodSoft: "rgba(52,211,153,0.16)",
  warn: "#fbbf24",
  warnSoft: "rgba(251,191,36,0.16)",
  bad: "#f87171",
  badSoft: "rgba(248,113,113,0.16)",
};

export const LIGHT: Palette = {
  background: "#f4f7fb",
  surface: "#ffffff",
  surfaceAlt: "#eef2f8",
  surfaceHover: "#e3e9f2",
  border: "#dde4ee",
  borderStrong: "#c4cedd",
  text: "#0f1b2e",
  textMuted: "#4c5a72",
  textFaint: "#8492a8",
  gridLine: "#e7ecf4",
  track: "#e9eef5",
  // Darker ramp, so values stay legible on light surfaces.
  accent: "#0284c7",
  accentSoft: "rgba(2,132,199,0.12)",
  njt: "#a16207",
  njtSoft: "rgba(161,98,7,0.12)",
  good: "#15803d",
  goodSoft: "rgba(21,128,61,0.12)",
  warn: "#c2410c",
  warnSoft: "rgba(194,65,12,0.12)",
  bad: "#dc2626",
  badSoft: "rgba(220,38,38,0.10)",
};

export const PALETTES = { dark: DARK, light: LIGHT } as const;
