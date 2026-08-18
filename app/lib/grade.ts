/**
 * A–F bands for an on-time percentage. Deliberately demanding, since NJT's
 * 6-minute OTP is generous: a "B" is ~1 in 10 trains missing even that cutoff.
 */
import { theme } from "./theme";

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface GradeResult {
  grade: Grade;
  color: string;
  /** Translucent tint for a badge background behind the grade. */
  tint: string;
}

const BANDS: { min: number; grade: Grade }[] = [
  { min: 95, grade: "A" },
  { min: 90, grade: "B" },
  { min: 85, grade: "C" },
  { min: 80, grade: "D" },
  { min: 0, grade: "F" },
];

const COLORS: Record<Grade, { color: string; tint: string }> = {
  A: { color: theme.colors.good, tint: theme.colors.goodSoft },
  B: { color: theme.colors.good, tint: theme.colors.goodSoft },
  C: { color: theme.colors.warn, tint: theme.colors.warnSoft },
  D: { color: theme.colors.bad, tint: theme.colors.badSoft },
  F: { color: theme.colors.bad, tint: theme.colors.badSoft },
};

export function reliabilityGrade(otpPercent: number): GradeResult {
  const grade = BANDS.find((b) => otpPercent >= b.min)?.grade ?? "F";
  return { grade, ...COLORS[grade] };
}
