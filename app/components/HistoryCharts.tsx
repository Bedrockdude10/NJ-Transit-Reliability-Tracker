import { StyleSheet, Text, View } from "react-native";
import type { HistoryResponse } from "@njt/shared";
import { otpColor, theme } from "../lib/theme";
import { BarChart, type BarDatum } from "./charts/BarChart";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pct = (v: number) => `${v}%`;
const otpBar = (label: string, value: number | null): BarDatum => ({
  label,
  value: value ?? 0,
  color: value !== null ? otpColor(value) : theme.colors.textMuted,
});

/** NJT's long-run published OTP: seasonality (by month) + annual trend. */
export function HistoryCharts({ history }: { history: HistoryResponse }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>By month of year (seasonality)</Text>
      <BarChart maxValue={100} formatValue={pct} data={history.seasonality.map((m) => otpBar(MONTH_ABBR[m.month] ?? String(m.month), m.avgOtpPercent))} />
      <Text style={styles.label}>By year</Text>
      <BarChart maxValue={100} formatValue={pct} data={history.annual.map((y) => otpBar(`’${String(y.year).slice(2)}`, y.avgOtpPercent))} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing(2) },
  label: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginTop: theme.spacing(1) },
});
