import type { ReactNode } from "react";
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

/**
 * "MODELED" pill — marks a metric as illustrative sample data (not a real
 * measurement) until the live GTFS-Realtime feed is connected. Pass via a
 * Card's `right` slot or inline beside a section title.
 */
export function ModeledBadge() {
  return (
    <View style={styles.modeled}>
      <Text style={styles.modeledText}>◇ MODELED</Text>
    </View>
  );
}

/** Full-width banner for screens whose data is entirely modeled until live RT. */
export function ModeledBanner({ children }: { children: ReactNode }) {
  return (
    <View style={styles.banner}>
      <ModeledBadge />
      <Text style={styles.bannerText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modeled: { backgroundColor: theme.colors.warnSoft, borderColor: theme.colors.warn, borderWidth: 1, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing(2), paddingVertical: 2, alignSelf: "flex-start" },
  modeledText: { color: theme.colors.warn, fontSize: theme.fontSize.xs, fontWeight: "800", letterSpacing: 0.4 },
  banner: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), flexWrap: "wrap", backgroundColor: theme.colors.warnSoft, borderColor: theme.colors.warn, borderWidth: 1, borderRadius: theme.radii.md, padding: theme.spacing(3) },
  bannerText: { color: theme.colors.text, fontSize: theme.fontSize.sm, flex: 1, lineHeight: 19 },
  grade: { borderRadius: theme.radii.md, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  gradeText: { fontWeight: "800", letterSpacing: -0.5 },
  trend: { flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: 3, borderRadius: theme.radii.pill },
  trendText: { fontSize: theme.fontSize.xs, fontWeight: "700" },
});
