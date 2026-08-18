import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, type DateRange } from "../lib/api";
import { officialPeriodLabel, formatDelayShort, formatInt, formatPercent } from "../lib/format";
import { hasHeatmapData, hasMeasuredOtp } from "../lib/measurement";
import { otpColor, otpColorAt, theme } from "../lib/theme";
import { useChartColors } from "../lib/useChartColors";
import { useWindow } from "../hooks/useWindow";
import { useApi } from "../hooks/useApi";
import { CsvExportButton } from "../components/CsvExportButton";
import { LiveBadge } from "../components/Indicators";
import { QueryBoundary } from "../components/QueryBoundary";
import { Gauge } from "../components/charts/Gauge";
import { Heatmap } from "../components/charts/Heatmap";
import { DelayHistogram, OtpComparison } from "../components/metrics";
import { HistoryCharts } from "../components/HistoryCharts";
import { TrendList } from "../components/TrendList";
import { Table } from "../components/Table";
import { WindowPicker } from "../components/WindowPicker";
import { Card, EmptyState, Eyebrow, PageTitle, Row, SkeletonCard, StatTile, Screen } from "../components/ui";

type Range = Required<DateRange>;

/**
 * The dashboard, as independently-loading panels: siblings under their own
 * boundaries fetch in parallel, where stacked `useSuspenseQuery` calls in one
 * component would serialise into a waterfall.
 */
export default function SystemOverview() {
  const { key: windowKey, range, select: selectWindow } = useWindow("30d");

  return (
    <Screen>
      <PageTitle title="System Overview" subtitle="NJ Transit commuter rail — independently measured reliability" />
      <Row>
        <WindowPicker value={windowKey} onChange={selectWindow} />
        <CsvExportButton url={api.exportUrl("system", range)} />
      </Row>

      <QueryBoundary pending={<SkeletonCard lines={4} />}>
        <HeadlinePanel range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <OfficialFiguresPanel range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <WhatChangedPanel />
      </QueryBoundary>

      <QueryBoundary>
        <BestAndWorstPanel />
      </QueryBoundary>

      <QueryBoundary>
        <ThresholdPanel range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <DistributionPanel range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <CancellationCausePanel range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <HeatmapPanel range={range} type="day_of_week" title="Average delay by day of week" />
      </QueryBoundary>

      <QueryBoundary>
        <HeatmapPanel range={range} type="hour_of_day" title="Average delay by hour of day" />
      </QueryBoundary>

      <QueryBoundary>
        <HistoryPanel />
      </QueryBoundary>
    </Screen>
  );
}

/** Its own query, deduped against the other panels by key. */
function useCollectionStart(): string | null {
  return useApi(api.health()).data.collectionStartDate;
}

function HeadlinePanel({ range }: { range: Range }) {
  const chartColors = useChartColors();
  const { data: s } = useApi(api.systemSummary(range));
  const collectionStartDate = useCollectionStart();

  const measured = hasMeasuredOtp(s.overall);
  const thr = (sec: number) => s.overall.thresholds.find((t) => t.thresholdSeconds === sec)?.otpPercent ?? null;
  const njt = s.njtOfficial?.otpPercent ?? null;
  const strict5 = measured ? thr(300) : null;
  const within15 = measured ? thr(900) : null;
  const headline = njt ?? within15;
  const gap = njt !== null && strict5 !== null ? Math.round((njt - strict5) * 10) / 10 : null;

  return (
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
  );
}

/** NJT's published monthly figures — the only numbers here that are not current. */
function OfficialFiguresPanel({ range }: { range: Range }) {
  const { data: s } = useApi(api.systemSummary(range));
  return (
    <Card
      title="NJ Transit's own published figures"
      subtitle={officialPeriodLabel(s.officialCoverage) ?? "Not yet published for any month"}
    >
      <Row>
        <StatTile label="Trips operated (NJT)" value={s.njtOfficial ? formatInt(s.njtOfficial.tripsOperated) : "—"} accent={theme.colors.accent} hint={s.njtOfficial ? `${s.njtOfficial.monthsCovered} mo published` : "no NJT data this period"} />
        <StatTile label="Cancellations (NJT)" value={s.njtOfficial ? formatInt(s.njtOfficial.cancellations) : "—"} color={theme.colors.bad} />
        <StatTile label="Cancellation rate (NJT)" value={s.njtOfficial ? formatPercent(s.njtOfficial.cancellationRatePercent) : "—"} />
        {s.fleetMdbf ? <StatTile label="Fleet MDBF (NJT)" value={`${formatInt(s.fleetMdbf.avgMiles)} mi`} hint="miles between failures" /> : null}
      </Row>
    </Card>
  );
}

function WhatChangedPanel() {
  const { data } = useApi(api.systemTrends());
  return (
    <Card title="What's changed" subtitle={`Last ${data.days} days vs the ${data.days} before`}>
      <TrendList trends={data.lines} />
    </Card>
  );
}

function BestAndWorstPanel() {
  const { data } = useApi(api.lines());
  const ranked = useMemo(
    () => data.lines.filter((l) => l.njtOtpPercent !== null).sort((a, b) => (b.njtOtpPercent ?? 0) - (a.njtOtpPercent ?? 0)),
    [data],
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (!best || !worst || best.id === worst.id) return null;

  return (
    <Row>
      <StatTile label="Most reliable line (NJT, latest)" value={`${best.shortName} · ${formatPercent(best.njtOtpPercent)}`} color={otpColor(best.njtOtpPercent ?? 0)} accent={otpColor(best.njtOtpPercent ?? 0)} hint={best.name} />
      <StatTile label="Least reliable line (NJT, latest)" value={`${worst.shortName} · ${formatPercent(worst.njtOtpPercent)}`} color={otpColor(worst.njtOtpPercent ?? 0)} accent={otpColor(worst.njtOtpPercent ?? 0)} hint={worst.name} />
    </Row>
  );
}

function ThresholdPanel({ range }: { range: Range }) {
  const { data: s } = useApi(api.systemSummary(range));
  const collectionStartDate = useCollectionStart();
  const measured = hasMeasuredOtp(s.overall);

  return (
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
  );
}

function DistributionPanel({ range }: { range: Range }) {
  const { data: s } = useApi(api.systemSummary(range));
  const collectionStartDate = useCollectionStart();
  return (
    <Card title="Delay distribution" subtitle="Trips by terminal lateness — the long tail a single percentage hides" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
      <DelayHistogram distribution={s.overall.delayDistribution} />
    </Card>
  );
}

function CancellationCausePanel({ range }: { range: Range }) {
  const { data: s } = useApi(api.systemSummary(range));
  const causes = s.njtCancellations;
  if (!causes || causes.byCause.length === 0) return null;

  return (
    <Card title="Why NJT cancels trains" subtitle={`${formatInt(causes.total)} cancellations over ${causes.monthsCovered} month(s), by NJT's own cause category`}>
      <Table
        columns={[
          { key: "cause", label: "Cause", flex: 2.2 },
          { key: "count", label: "Count", align: "right" },
          { key: "pct", label: "Share", align: "right" },
        ]}
        rows={causes.byCause.slice(0, 8).map((cause) => ({ cause: cause.cause, count: cause.count, pct: `${cause.percent}%` }))}
      />
    </Card>
  );
}

function HeatmapPanel({ range, type, title }: { range: Range; type: "day_of_week" | "hour_of_day"; title: string }) {
  const { data } = useApi(api.systemHeatmap(range, type));
  const collectionStartDate = useCollectionStart();

  return (
    <Card title={title} right={<LiveBadge collectionStartDate={collectionStartDate} />}>
      {hasHeatmapData(data.buckets) ? (
        <Heatmap
          cells={data.buckets.map((b) => ({
            label: type === "hour_of_day" ? b.label.replace(":00", "") : b.label,
            value: b.avgDelaySeconds,
            observations: b.observations,
          }))}
        />
      ) : (
        <EmptyState title="No data yet" hint="These appear once the live feed has recorded trips." />
      )}
    </Card>
  );
}

function HistoryPanel() {
  const { data } = useApi(api.systemHistory());
  if (data.annual.length === 0) return null;
  return (
    <Card title="NJT on-time history (system)" subtitle="Real published figures across every year on record">
      <HistoryCharts history={data} />
    </Card>
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
