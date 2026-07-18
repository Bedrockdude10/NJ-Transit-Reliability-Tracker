import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { formatDelayShort, formatInt, formatPercent } from "../lib/format";
import { hasHeatmapData, hasMeasuredOtp } from "../lib/measurement";
import { otpColor, otpColorAt, theme } from "../lib/theme";
import { useChartColors } from "../lib/useChartColors";
import { windowToRange, type WindowKey } from "../lib/windows";
import { useApi } from "../hooks/useApi";
import { CsvExportButton } from "../components/CsvExportButton";
import { LiveBadge } from "../components/Indicators";
import { Gauge } from "../components/charts/Gauge";
import { Heatmap } from "../components/charts/Heatmap";
import { DelayHistogram, OtpComparison } from "../components/metrics";
import { HistoryCharts } from "../components/HistoryCharts";
import { Table } from "../components/Table";
import { WindowPicker } from "../components/WindowPicker";
import { Card, EmptyState, Eyebrow, ErrorView, Loading, Muted, PageTitle, Row, SkeletonCard, StatTile, Screen } from "../components/ui";

export default function SystemOverview() {
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);
  const chartColors = useChartColors();

  const summary = useApi(() => api.systemSummary(range), [range.from, range.to]);
  const dow = useApi(() => api.systemHeatmap(range, "day_of_week"), [range.from, range.to]);
  const hour = useApi(() => api.systemHeatmap(range, "hour_of_day"), [range.from, range.to]);
  const history = useApi(() => api.systemHistory(), []);
  const lines = useApi(() => api.lines(), []);
  const health = useApi(() => api.health(), []);
  const collectionStartDate = health.data?.collectionStartDate ?? null;

  const ranked = useMemo(
    () =>
      (lines.data?.lines ?? [])
        .filter((l) => l.njtOtpPercent !== null)
        .sort((a, b) => (b.njtOtpPercent ?? 0) - (a.njtOtpPercent ?? 0)),
    [lines.data],
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const s = summary.data;
  const measured = hasMeasuredOtp(s?.overall);
  const thr = (sec: number) => s?.overall.thresholds.find((t) => t.thresholdSeconds === sec)?.otpPercent ?? null;
  const njt = s?.njtOfficial?.otpPercent ?? null;
  // Independent thresholds are only real once the live feed has recorded trips.
  const strict5 = measured ? thr(300) : null;
  const within15 = measured ? thr(900) : null;
  // Prefer NJT's real figure for the hero; fall back to our measurement; else no data.
  const headline = njt ?? within15;
  const gap = njt !== null && strict5 !== null ? Math.round((njt - strict5) * 10) / 10 : null;

  return (
    <Screen>
      <PageTitle title="System Overview" subtitle="NJ Transit commuter rail — independently measured reliability" />
      <Row>
        <WindowPicker value={windowKey} onChange={(key, d) => { setWindowKey(key); setDays(d); }} />
        <CsvExportButton url={api.exportUrl("system", range)} />
      </Row>

      {summary.loading ? <SkeletonCard lines={4} /> : null}
      {summary.error ? <ErrorView message={summary.error} onRetry={summary.reload} /> : null}

      {s ? (
        <>
          {/* Hero: the headline NJT figure next to the stricter (measured) reality. */}
          <Card>
            <Eyebrow>How on-time is NJ Transit, really?</Eyebrow>
            <View style={styles.hero}>
              {headline !== null ? (
                <Gauge value={headline} color={otpColorAt(chartColors, headline)} label={formatPercent(Math.round(headline))} caption={njt !== null ? "NJT official · 6 min" : "Measured · ≤15 min"} />
              ) : (
                <Gauge value={0} color={theme.colors.textFaint} label="N/A" caption="No data yet" />
              )}
              <View style={styles.heroText}>
                <Text style={styles.heroLede}>
                  NJT counts a train “on time” if it arrives within <Text style={styles.bold}>6 minutes</Text> of schedule. At stricter
                  thresholds the picture changes — these are <Text style={styles.bold}>independently measured</Text> from the live feed:
                </Text>
                <View style={styles.heroBadgeRow}>
                  <LiveBadge collectionStartDate={collectionStartDate} />
                  <Text style={styles.heroBadgeNote}>independent OTP from GTFS-Realtime</Text>
                </View>
                {measured ? (
                  <Row>
                    {strict5 !== null ? <StatTile label="On time ≤5 min" value={formatPercent(strict5)} color={otpColor(strict5)} accent={otpColor(strict5)} /> : null}
                    {within15 !== null ? <StatTile label="On time ≤15 min" value={formatPercent(within15)} color={otpColor(within15)} accent={otpColor(within15)} /> : null}
                    {gap !== null ? <StatTile label="Gap vs NJT (6 min)" value={`${gap} pts`} color={theme.colors.bad} accent={theme.colors.bad} hint="stricter threshold = lower" /> : null}
                  </Row>
                ) : (
                  <EmptyState title="No data yet" hint="Stricter-threshold on-time rates appear once the live feed has recorded trips." />
                )}
              </View>
            </View>
          </Card>

          {/* Real, NJT-reported operations for the period. */}
          <Row>
            <StatTile label="Trips operated (NJT)" value={s.njtOfficial ? formatInt(s.njtOfficial.tripsOperated) : "—"} accent={theme.colors.accent} hint={s.njtOfficial ? `${s.njtOfficial.monthsCovered} mo published` : "no NJT data this period"} />
            <StatTile label="Cancellations (NJT)" value={s.njtOfficial ? formatInt(s.njtOfficial.cancellations) : "—"} color={theme.colors.bad} />
            <StatTile label="Cancellation rate (NJT)" value={s.njtOfficial ? formatPercent(s.njtOfficial.cancellationRatePercent) : "—"} />
            {s.fleetMdbf ? <StatTile label="Fleet MDBF (NJT)" value={`${formatInt(s.fleetMdbf.avgMiles)} mi`} hint="miles between failures" /> : null}
          </Row>

          {best && worst && best.id !== worst.id ? (
            <Row>
              <StatTile label="Most reliable line (NJT, latest)" value={`${best.shortName} · ${formatPercent(best.njtOtpPercent)}`} color={otpColor(best.njtOtpPercent ?? 0)} accent={otpColor(best.njtOtpPercent ?? 0)} hint={best.name} />
              <StatTile label="Least reliable line (NJT, latest)" value={`${worst.shortName} · ${formatPercent(worst.njtOtpPercent)}`} color={otpColor(worst.njtOtpPercent ?? 0)} accent={otpColor(worst.njtOtpPercent ?? 0)} hint={worst.name} />
            </Row>
          ) : null}

          <Card title="On-time performance vs. NJT" subtitle="Independent OTP at strict thresholds against NJT's loose 6-minute figure" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
            <OtpComparison thresholds={s.overall.thresholds} njtOfficial={s.njtOfficial} measured={measured} />
            {measured ? (
              <Row>
                <StatTile label="Median delay" value={formatDelayShort(s.overall.medianDelaySeconds)} />
                <StatTile label="P90 delay" value={formatDelayShort(s.overall.p90DelaySeconds)} color={theme.colors.warn} accent={theme.colors.warn} />
                <StatTile label="Avg delay" value={formatDelayShort(s.overall.avgDelaySeconds)} />
              </Row>
            ) : null}
          </Card>

          <Card title="Delay distribution" subtitle="Trips by terminal lateness — the long tail a single percentage hides" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
            <DelayHistogram distribution={s.overall.delayDistribution} />
          </Card>

          {s.njtCancellations && s.njtCancellations.byCause.length > 0 ? (
            <Card title="Why NJT cancels trains" subtitle={`${formatInt(s.njtCancellations.total)} cancellations over ${s.njtCancellations.monthsCovered} month(s), by NJT's own cause category`}>
              <Table
                columns={[
                  { key: "cause", label: "Cause", flex: 2.2 },
                  { key: "count", label: "Count", align: "right" },
                  { key: "pct", label: "Share", align: "right" },
                ]}
                rows={s.njtCancellations.byCause.slice(0, 8).map((cause) => ({ cause: cause.cause, count: cause.count, pct: `${cause.percent}%` }))}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <Card title="Average delay by day of week" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
        {!dow.data ? <Loading /> : hasHeatmapData(dow.data.buckets) ? <Heatmap cells={dow.data.buckets.map((b) => ({ label: b.label, value: b.avgDelaySeconds, observations: b.observations }))} /> : <EmptyState title="No data yet" hint="Day-of-week delays appear once the live feed has recorded trips." />}
      </Card>

      <Card title="Average delay by hour of day" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
        {!hour.data ? <Loading /> : hasHeatmapData(hour.data.buckets) ? <Heatmap cells={hour.data.buckets.map((b) => ({ label: b.label.replace(":00", ""), value: b.avgDelaySeconds, observations: b.observations }))} /> : <EmptyState title="No data yet" hint="Hour-of-day delays appear once the live feed has recorded trips." />}
      </Card>

      {history.data && history.data.annual.length > 0 ? (
        <Card title="NJT on-time history (system)" subtitle="Real published figures across every year on record">
          <HistoryCharts history={history.data} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing(5) },
  heroText: { flex: 1, minWidth: 260, gap: theme.spacing(3) },
  heroLede: { color: theme.colors.textMuted, fontSize: theme.fontSize.md, lineHeight: 23 },
  heroBadgeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  heroBadgeNote: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },
  bold: { color: theme.colors.text, fontWeight: "700" },
});
