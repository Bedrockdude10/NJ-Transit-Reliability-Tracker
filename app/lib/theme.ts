/** Design tokens. Plain object so it's usable from components and tests alike. */
export const theme = {
  colors: {
    background: "#0f172a",
    surface: "#1e293b",
    surfaceAlt: "#273449",
    border: "#334155",
    text: "#f1f5f9",
    textMuted: "#94a3b8",
    accent: "#38bdf8",
    good: "#22c55e",
    warn: "#f59e0b",
    bad: "#ef4444",
    njt: "#facc15",
  },
  spacing: (n: number) => n * 4,
  radius: 12,
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 24,
    xxl: 32,
  },
} as const;

/** Pick a color for an OTP percentage (higher is better). */
export function otpColor(percent: number): string {
  if (percent >= 90) return theme.colors.good;
  if (percent >= 75) return theme.colors.warn;
  return theme.colors.bad;
}
