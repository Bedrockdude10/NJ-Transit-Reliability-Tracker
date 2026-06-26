import { StyleSheet, Text, View } from "react-native";
import { reliabilityGrade } from "../lib/grade";
import { theme } from "../lib/theme";

/** Letter-grade chip for an OTP percentage (A–F), tinted by grade. */
export function GradeBadge({ otpPercent, size = 46 }: { otpPercent: number; size?: number }) {
  const { grade, color, tint } = reliabilityGrade(otpPercent);
  return (
    <View style={[styles.grade, { width: size, height: size, backgroundColor: tint, borderColor: color }]}>
      <Text style={[styles.gradeText, { color, fontSize: size * 0.46 }]}>{grade}</Text>
    </View>
  );
}

/**
 * Directional change indicator. `delta` is the signed change; by default a
 * positive delta reads as good (green ▲). Set `goodWhenUp={false}` for metrics
 * where higher is worse (e.g. delay).
 */
export function TrendBadge({
  delta,
  unit = "pts",
  goodWhenUp = true,
}: {
  delta: number | null;
  unit?: string;
  goodWhenUp?: boolean;
}) {
  if (delta === null || delta === undefined) return null;
  const flat = Math.abs(delta) < 0.1;
  const up = delta > 0;
  const good = up === goodWhenUp;
  const color = flat ? theme.colors.textFaint : good ? theme.colors.good : theme.colors.bad;
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return (
    <View style={[styles.trend, { backgroundColor: flat ? theme.colors.surfaceAlt : good ? theme.colors.goodSoft : theme.colors.badSoft }]}>
      <Text style={[styles.trendText, { color }]}>
        {arrow} {flat ? "flat" : `${Math.abs(Math.round(delta * 10) / 10)} ${unit}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grade: { borderRadius: theme.radii.md, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  gradeText: { fontWeight: "800", letterSpacing: -0.5 },
  trend: { flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: 3, borderRadius: theme.radii.pill },
  trendText: { fontSize: theme.fontSize.xs, fontWeight: "700" },
});
