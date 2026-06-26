/**
 * Design tokens. Colors are exposed as **CSS variables** (`var(--njt-<key>)`)
 * so the entire HTML/React-Native-Web surface re-themes for light/dark via
 * `prefers-color-scheme` with no per-component work — the concrete values live
 * in `palette.ts` and are emitted in `app/app/+html.tsx`.
 *
 * SVG components can't resolve CSS variables in presentation attributes, so they
 * read concrete colors for the active scheme via `useChartColors()` and use
 * `otpColorAt()` / `otpColorSoftAt()` instead of the `var()` helpers below.
 *
 * Spacing, radii, type, and elevation are scheme-independent.
 */
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

// --- OTP → color -------------------------------------------------------------
// `var()` variants for the HTML/RNW world (auto-themed). The `*At` variants take
// a concrete palette (from useChartColors) for SVG, where var() doesn't resolve.

/** Pick a CSS-variable color for an OTP percentage (higher is better). */
export function otpColor(percent: number): string {
  if (percent >= 90) return theme.colors.good;
  if (percent >= 75) return theme.colors.warn;
  return theme.colors.bad;
}

/** Translucent CSS-variable tint matching otpColor. */
export function otpColorSoft(percent: number): string {
  if (percent >= 90) return theme.colors.goodSoft;
  if (percent >= 75) return theme.colors.warnSoft;
  return theme.colors.badSoft;
}

/** Concrete OTP color from a resolved palette (for SVG). */
export function otpColorAt(palette: Palette, percent: number): string {
  if (percent >= 90) return palette.good;
  if (percent >= 75) return palette.warn;
  return palette.bad;
}
