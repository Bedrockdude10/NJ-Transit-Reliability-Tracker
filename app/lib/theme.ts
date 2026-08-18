/**
 * Design tokens. Colors are CSS variables (`var(--njt-<key>)`), emitted in
 * `app/app/+html.tsx` from `palette.ts`, so light/dark needs no per-component
 * work. SVG cannot resolve `var()` in presentation attributes, so SVG uses
 * `useChartColors()` with the `*At` helpers instead.
 */
import { OTP_FAIR_THRESHOLD_PERCENT, OTP_GOOD_THRESHOLD_PERCENT } from "@njt/shared";
import { DARK, type ColorKey, type Palette } from "./palette";

const cssVars = Object.fromEntries((Object.keys(DARK) as ColorKey[]).map((k) => [k, `var(--njt-${k})`])) as Palette;

export const theme = {
  colors: cssVars,

  spacing: (n: number) => n * 4,

  radius: 14,
  radii: { sm: 8, md: 14, lg: 20, pill: 999 },

  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 32, display: 44 },

  fontWeight: { regular: "400", medium: "500", semibold: "600", bold: "700", heavy: "800" },

  fontFamily: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },

  shadow: {
    card: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
    pop: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  },
} as const;

/** CSS-variable color for an OTP percentage (higher is better). */
export function otpColor(percent: number): string {
  if (percent >= OTP_GOOD_THRESHOLD_PERCENT) return theme.colors.good;
  if (percent >= OTP_FAIR_THRESHOLD_PERCENT) return theme.colors.warn;
  return theme.colors.bad;
}

/** Translucent tint matching otpColor. */
export function otpColorSoft(percent: number): string {
  if (percent >= OTP_GOOD_THRESHOLD_PERCENT) return theme.colors.goodSoft;
  if (percent >= OTP_FAIR_THRESHOLD_PERCENT) return theme.colors.warnSoft;
  return theme.colors.badSoft;
}

/** Concrete OTP color from a resolved palette (for SVG). */
export function otpColorAt(palette: Palette, percent: number): string {
  if (percent >= OTP_GOOD_THRESHOLD_PERCENT) return palette.good;
  if (percent >= OTP_FAIR_THRESHOLD_PERCENT) return palette.warn;
  return palette.bad;
}
