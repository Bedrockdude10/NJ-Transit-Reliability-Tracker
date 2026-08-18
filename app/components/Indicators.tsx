import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { reliabilityGrade } from "../lib/grade";
import { measurementStatus } from "../lib/measurement";
import { theme } from "../lib/theme";

export function GradeBadge({ otpPercent, size = 46 }: { otpPercent: number; size?: number }) {
  const { grade, color, tint } = reliabilityGrade(otpPercent);
  return (
    <View style={[styles.grade, { width: size, height: size, backgroundColor: tint, borderColor: color }]}>
      <Text style={[styles.gradeText, { color, fontSize: size * 0.46 }]}>{grade}</Text>
    </View>
  );
}

/** Set `goodWhenUp={false}` for metrics where higher is worse, e.g. delay. */
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

/** Marks a metric as measured from the live feed. Goes in a Card's `right` slot. */
export function LiveBadge({ collectionStartDate }: { collectionStartDate: string | null | undefined }) {
  const { live, badge } = measurementStatus(collectionStartDate);
  return (
    <View style={[styles.badge, live ? styles.badgeLive : styles.badgeIdle]}>
      <Text style={[styles.badgeText, live ? styles.badgeTextLive : styles.badgeTextIdle]}>
        {live ? "◆" : "◇"} {badge}
      </Text>
    </View>
  );
}

/** `children` notes what is real regardless of collection status, e.g. GTFS names. */
export function LiveBanner({
  collectionStartDate,
  children,
}: {
  collectionStartDate: string | null | undefined;
  children?: ReactNode;
}) {
  const { live, label } = measurementStatus(collectionStartDate);
  return (
    <View style={[styles.banner, live ? styles.bannerLive : styles.bannerIdle]}>
      <LiveBadge collectionStartDate={collectionStartDate} />
      <Text style={styles.bannerText}>
        {label}
        {children ? <Text> {children}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing(2), paddingVertical: 2, alignSelf: "flex-start" },
  badgeLive: { backgroundColor: theme.colors.goodSoft, borderColor: theme.colors.good },
  badgeIdle: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
  badgeText: { fontSize: theme.fontSize.xs, fontWeight: "800", letterSpacing: 0.4 },
  badgeTextLive: { color: theme.colors.good },
  badgeTextIdle: { color: theme.colors.textFaint },
  banner: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), flexWrap: "wrap", borderWidth: 1, borderRadius: theme.radii.md, padding: theme.spacing(3) },
  bannerLive: { backgroundColor: theme.colors.goodSoft, borderColor: theme.colors.good },
  bannerIdle: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
  bannerText: { color: theme.colors.text, fontSize: theme.fontSize.sm, flex: 1, lineHeight: 19 },
  grade: { borderRadius: theme.radii.md, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  gradeText: { fontWeight: "800", letterSpacing: -0.5 },
  trend: { flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: 3, borderRadius: theme.radii.pill },
  trendText: { fontSize: theme.fontSize.xs, fontWeight: "700" },
});
