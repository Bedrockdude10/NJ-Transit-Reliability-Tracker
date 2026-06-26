import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { buildComparison, fillForward, type CompareInput } from "../../lib/compare";
import { formatMonth, formatPercent } from "../../lib/format";
import { theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { LineChart, type LineSeries } from "../../components/charts/LineChart";
import { Table } from "../../components/Table";
import { Card, ErrorView, Loading, Muted, PageTitle, SectionTitle, Screen } from "../../components/ui";

const MAX_SELECTED = 5;
// Fallback palette for lines NJT publishes no color for.
const PALETTE = [theme.colors.accent, theme.colors.njt, theme.colors.good, theme.colors.warn, theme.colors.bad];

// Remember the user's selection across in-session navigations (resets on full
// reload). `null` means "untouched — show the default"; an array (including [])
// is an explicit choice that sticks, so clearing it no longer springs back.
let remembered: string[] | null = null;

export default function Compare() {
  const list = useApi(() => api.lines(), []);
  const lines = list.data?.lines ?? [];

  const [selected, setSelectedState] = useState<string[] | null>(remembered);
  const setSelected = useCallback((next: string[]) => {
    remembered = next;
    setSelectedState(next);
  }, []);

  // Neutral default: the first two lines with NJT data, alphabetically — not an
  // editorial "worst performers" pairing the user has to keep deselecting.
  const defaultIds = useMemo(
    () =>
      [...lines]
        .filter((l) => l.njtOtpPercent !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 2)
        .map((l) => l.id),
    [lines],
  );
  const effective = selected ?? defaultIds;

  const key = effective.join(",");
  const monthly = useApi(
    () => Promise.all(effective.map((id) => api.lineMonthly(id))),
    [key],
  );

  const comparison = useMemo(() => {
    if (!monthly.data) return null;
    const inputs: CompareInput[] = monthly.data.map((m) => {
      const meta = lines.find((l) => l.id === m.lineId);
      return { id: m.lineId, name: meta?.name ?? m.name, color: meta?.color ?? null, monthly: m };
    });
    return buildComparison(inputs);
  }, [monthly.data, lines]);

  const toggle = (id: string) => {
    const base = effective;
    if (base.includes(id)) {
      setSelected(base.filter((x) => x !== id)); // may become [] — and stays []
    } else if (base.length < MAX_SELECTED) {
      setSelected([...base, id]);
    }
  };

  const series: LineSeries[] = (comparison?.series ?? []).map((s, i) => ({
    label: s.name,
    color: s.color ? `#${s.color}` : PALETTE[i % PALETTE.length]!,
    values: fillForward(s.values),
  }));

  return (
    <Screen>
      <PageTitle
        title="Compare lines"
        subtitle="NJT's published 6-min on-time performance, side by side — real figures back to 2017"
      />

      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : null}

      <Card>
        <SectionTitle>Pick lines to compare</SectionTitle>
        <Muted>Up to {MAX_SELECTED} at once.</Muted>
        <View style={styles.chips}>
          {lines.map((line) => {
            const on = effective.includes(line.id);
            return (
              <Pressable
                key={line.id}
                onPress={() => toggle(line.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                {line.color ? <View style={[styles.dot, { backgroundColor: `#${line.color}` }]} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{line.shortName}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <SectionTitle>On-time performance over time</SectionTitle>
        {monthly.loading ? <Loading /> : null}
        {comparison && series.some((s) => s.values.length > 0) ? (
          <>
            <LineChart height={220} series={series.filter((s) => s.values.length > 0)} />
            <Muted>
              {comparison.months.length} months ({formatMonth(`${comparison.months[0]}-01`)} →{" "}
              {formatMonth(`${comparison.months.at(-1)}-01`)}). Gaps are carried forward so each line reads as one
              continuous trace.
            </Muted>
          </>
        ) : monthly.loading ? null : (
          <Muted>Select at least one line with published NJT data.</Muted>
        )}
      </Card>

      {comparison && comparison.series.length > 0 ? (
        <Card>
          <SectionTitle>Latest published month</SectionTitle>
          <Table
            columns={[
              { key: "name", label: "Line", flex: 2 },
              { key: "latest", label: "NJT OTP", align: "right" },
              { key: "month", label: "Month", align: "right", flex: 1.3 },
              { key: "avg", label: "Avg (range)", align: "right", flex: 1.3 },
            ]}
            rows={comparison.series.map((s) => ({
              name: s.name,
              latest: formatPercent(s.latestOtpPercent),
              month: s.latestMonth ? formatMonth(`${s.latestMonth}-01`) : "—",
              avg: formatPercent(s.avgOtpPercent),
            }))}
          />
          <Muted>
            “Avg (range)” is the mean of each line's published months across the union shown above — useful for
            ranking, but lines with different coverage aren't strictly comparable.
          </Muted>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, fontWeight: "600" },
  chipTextOn: { color: theme.colors.text },
});
