import { StyleSheet, Text, View } from "react-native";
import type { HistoryResponse } from "@njt/shared";
import { otpColorAt, theme } from "../lib/theme";
import { useChartColors } from "../lib/useChartColors";
import type { Palette } from "../lib/palette";
import { BarChart, type BarDatum } from "./charts/BarChart";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pct = (v: number) => `${v}%`;
const otpBar = (c: Palette, label: string, value: number | null): BarDatum => ({
  label,
  value: value ?? 0,
  color: value !== null ? otpColorAt(c, value) : c.textMuted,
});

/** NJT's long-run published OTP: seasonality (by month) + annual trend. */
export function HistoryCharts({ history }: { history: HistoryResponse }) {
  const c = useChartColors();
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>By month of year (seasonality)</Text>
      <BarChart maxValue={100} formatValue={pct} data={history.seasonality.map((m) => otpBar(c, MONTH_ABBR[m.month] ?? String(m.month), m.avgOtpPercent))} />
      <Text style={styles.label}>By year</Text>
      <BarChart maxValue={100} formatValue={pct} data={history.annual.map((y) => otpBar(c, `’${String(y.year).slice(2)}`, y.avgOtpPercent))} />
      {history.mdbfAnnual && history.mdbfAnnual.length > 0 ? (
        <>
          <Text style={styles.label}>Fleet reliability — avg miles between failures, by year</Text>
          <BarChart
            formatValue={(v) => `${Math.round(v / 1000)}k`}
            data={history.mdbfAnnual.map((m) => ({ label: `’${String(m.year).slice(2)}`, value: m.avgMdbf, color: c.accent }))}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing(2) },
  label: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginTop: theme.spacing(1) },
});
