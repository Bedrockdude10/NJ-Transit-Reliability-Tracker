import { DELAY_BUCKETS, type DistributionBucketResult, type NjtOfficialComparison, type OtpThresholdResult } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { hasDistributionData } from "../lib/measurement";
import { theme, otpColorAt } from "../lib/theme";
import { useChartColors } from "../lib/useChartColors";
import { BarChart, type BarDatum } from "./charts/BarChart";
import { EmptyState, Muted } from "./ui";

/**
 * Independent OTP at strict thresholds next to NJT's loose 6-minute figure.
 * `measured` gates the independent bars — with no trips recorded they would
 * otherwise render as a misleading row of 0%.
 */
export function OtpComparison({
  thresholds,
  njtOfficial,
  measured = true,
}: {
  thresholds: OtpThresholdResult[];
  njtOfficial: NjtOfficialComparison | null;
  measured?: boolean;
}) {
  const c = useChartColors();
  if (!measured) {
    return (
      <EmptyState
        title="No data yet"
        hint="Independent on-time performance appears once the live feed has recorded trips for this period."
      />
    );
  }
  const data: BarDatum[] = thresholds.map((t) => ({
    label: `≤${t.thresholdMinutes}m`,
    value: t.otpPercent,
    color: otpColorAt(c, t.otpPercent),
  }));
  const referenceLine = njtOfficial
    ? { value: njtOfficial.otpPercent, label: `NJT 6 min · ${njtOfficial.otpPercent}%`, color: c.njt }
    : undefined;
  return (
    <View style={styles.block}>
      <BarChart data={data} height={220} maxValue={100} referenceLine={referenceLine} formatValue={(v) => `${v}%`} />
      <Muted>
        Each bar is the on-time rate at that lateness threshold (stricter on the left).
        {njtOfficial
          ? ` The dashed line is NJT’s reported 6-minute figure (${njtOfficial.monthsCovered} mo) — at strict thresholds the real number sits well below it.`
          : " No NJT official figure for this period."}
      </Muted>
    </View>
  );
}

// Short labels are SSOT in @njt/shared (DELAY_BUCKETS[].shortLabel) — map, don't re-inline.
const SHORT: Record<string, string> = Object.fromEntries(DELAY_BUCKETS.map((b) => [b.label, b.shortLabel]));

export function DelayHistogram({ distribution }: { distribution: DistributionBucketResult[] }) {
  const c = useChartColors();
  if (!hasDistributionData(distribution)) {
    return (
      <EmptyState
        title="No data yet"
        hint="The delay distribution fills in as the live feed records trips for this period."
      />
    );
  }
  const data: BarDatum[] = distribution.map((b) => ({ label: SHORT[b.label] ?? b.label, value: b.count, color: c.accent }));
  return (
    <View style={styles.block}>
      <BarChart data={data} height={190} formatValue={(v) => String(v)} />
      <Muted>Trips by terminal delay (minutes late). The long right tail is what a single “on-time %” hides.</Muted>
    </View>
  );
}

export function GapCallout({
  strictPercent,
  njtPercent,
  measured = true,
}: {
  strictPercent: number;
  njtPercent: number | null;
  measured?: boolean;
}) {
  // Without an independent measurement `strictPercent` is a hollow 0%, not a gap.
  if (njtPercent === null || !measured) return null;
  const gap = Math.round((njtPercent - strictPercent) * 10) / 10;
  return (
    <View style={styles.callout}>
      <Text style={styles.calloutText}>
        NJT reports <Text style={styles.njt}>{njtPercent}%</Text> on-time (6 min). At a 5-minute threshold it is{" "}
        <Text style={styles.strict}>{strictPercent}%</Text> — a <Text style={styles.gap}>{gap}-point</Text> gap.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing(2) },
  callout: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius, padding: theme.spacing(3), borderLeftWidth: 3, borderLeftColor: theme.colors.njt },
  calloutText: { color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: 22 },
  njt: { color: theme.colors.njt, fontWeight: "700" },
  strict: { color: theme.colors.accent, fontWeight: "700" },
  gap: { color: theme.colors.bad, fontWeight: "700" },
});
