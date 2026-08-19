import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, type DateRange } from "../../lib/api";
import { officialPeriodLabel, formatDelayShort, formatDelaySeconds, formatInt, formatMonth, formatPercent } from "../../lib/format";
import { hasMeasuredOtp } from "../../lib/measurement";
import { theme, otpColor, otpColorAt } from "../../lib/theme";
import { useChartColors } from "../../lib/useChartColors";
import { useWindow } from "../../hooks/useWindow";
import { useApi } from "../../hooks/useApi";
import { GradeBadge, LiveBadge, TrendBadge } from "../../components/Indicators";
import { Sparkline } from "../../components/charts/Sparkline";
import { CsvExportButton } from "../../components/CsvExportButton";
import { LineChart } from "../../components/charts/LineChart";
import { HistoryCharts } from "../../components/HistoryCharts";
import { DelayHistogram, GapCallout, OtpComparison } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { QueryBoundary } from "../../components/QueryBoundary";
import { Card, EmptyState, Loading, Muted, PageTitle, Row, SectionTitle, SegmentedControl, StatTile, Screen } from "../../components/ui";
import { PropagationChart } from "../../components/PropagationChart";

type Range = Required<DateRange>;

/**
 * Line detail, as independently-loading sections: six queries as sibling
 * boundaries go out together, where stacking them in one component would
 * serialise into six round trips.
 */
export default function LineDetail() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const id = lineId ?? "";
  const { key: windowKey, range, select: selectWindow } = useWindow();

  return (
    <Screen>
      <QueryBoundary pending={<PageTitle title={id} subtitle="Line reliability detail" />}>
        <LineHeader id={id} range={range} />
      </QueryBoundary>

      <Row>
        <WindowPicker value={windowKey} onChange={selectWindow} />
        <CsvExportButton url={api.exportUrl("line", range, id)} />
      </Row>

      <QueryBoundary><LineMeasurements id={id} range={range} /></QueryBoundary>
      <QueryBoundary><DelayPropagation id={id} range={range} /></QueryBoundary>
      <QueryBoundary><CancellationCauses id={id} range={range} /></QueryBoundary>
      <QueryBoundary><OtpTrend id={id} range={range} /></QueryBoundary>
      <QueryBoundary><PublishedHistory id={id} /></QueryBoundary>
      <QueryBoundary><AnnualHistory id={id} /></QueryBoundary>
      <QueryBoundary><MonthlyComparison id={id} /></QueryBoundary>
      <QueryBoundary><WorstTrips id={id} range={range} /></QueryBoundary>
      <QueryBoundary><AmtrakAttribution id={id} range={range} /></QueryBoundary>
    </Screen>
  );
}

function useNjtMonthly(id: string) {
  const { data } = useApi(api.lineMonthly(id));
  return useMemo(() => data.rows.filter((r) => r.njtOtpPercent !== null).reverse(), [data]);
}

function useCollectionStart(): string | null {
  return useApi(api.health()).data.collectionStartDate;
}

function LineHeader({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineSummary(id, range));
  const njtMonthly = useNjtMonthly(id);
  const c = useChartColors();

  // Latest published month and the prior one, for the report-card header trend.
  const latestM = njtMonthly.at(-1) ?? null;
  const prevM = njtMonthly.at(-2) ?? null;
  const momDelta =
    latestM?.njtOtpPercent != null && prevM?.njtOtpPercent != null
      ? Math.round((latestM.njtOtpPercent - prevM.njtOtpPercent) * 10) / 10
      : null;

  return (
    <>
      <PageTitle title={data.name} subtitle="Line reliability detail" />
      {latestM?.njtOtpPercent != null ? (
        <View style={styles.report}>
          <GradeBadge otpPercent={latestM.njtOtpPercent} size={56} />
          <View style={styles.reportMain}>
            <Text style={styles.reportOtp}>{formatPercent(latestM.njtOtpPercent)} on-time</Text>
            <Muted>NJT official · 6 min · {formatMonth(`${latestM.month}-01`)}</Muted>
          </View>
          {njtMonthly.length >= 2 ? (
            <Sparkline values={njtMonthly.slice(-12).map((r) => r.njtOtpPercent as number)} width={120} height={40} color={otpColorAt(c, latestM.njtOtpPercent)} />
          ) : null}
          <View style={styles.reportTrend}>
            <TrendBadge delta={momDelta} />
            <Text style={styles.vsLabel}>vs prior month</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

function LineMeasurements({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineSummary(id, range));
  const collectionStartDate = useCollectionStart();
  const measured = hasMeasuredOtp(data.overall);
  const inbound15 = data.inbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0;
  const outbound15 = data.outbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0;

  return (
    <>
      <GapCallout
        strictPercent={data.overall.thresholds[0]?.otpPercent ?? 0}
        njtPercent={data.njtOfficial?.otpPercent ?? null}
        measured={measured}
      />

      <Card
        title="NJ Transit's own published figures"
        subtitle={officialPeriodLabel(data.officialCoverage) ?? "Not yet published for this line"}
      >
        <Row>
          <StatTile label="Trips operated (NJT)" value={data.njtOfficial ? formatInt(data.njtOfficial.tripsOperated) : "—"} accent={theme.colors.accent} hint={data.njtOfficial ? `${data.njtOfficial.monthsCovered} mo published` : "no NJT data this period"} />
          <StatTile label="Cancellations (NJT)" value={data.njtOfficial ? formatInt(data.njtOfficial.cancellations) : "—"} color={theme.colors.bad} />
          <StatTile label="Cancellation rate (NJT)" value={data.njtOfficial ? formatPercent(data.njtOfficial.cancellationRatePercent) : "—"} />
        </Row>
      </Card>

      <Card title="On-time performance vs. NJT" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
        <OtpComparison thresholds={data.overall.thresholds} njtOfficial={data.njtOfficial} measured={measured} />
        {measured ? (
          <Row>
            <StatTile label="Avg delay" value={formatDelaySeconds(data.overall.avgDelaySeconds)} />
            <StatTile label="P90 delay" value={formatDelaySeconds(data.overall.p90DelaySeconds)} color={theme.colors.warn} accent={theme.colors.warn} />
          </Row>
        ) : null}
      </Card>

      <Card title="Inbound vs. outbound" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
        {measured ? (
          <Row>
            <StatTile label="Inbound OTP ≤15m" value={formatPercent(inbound15)} color={otpColor(inbound15)} hint={`${formatInt(data.inbound.tripsOperated)} trips`} />
            <StatTile label="Outbound OTP ≤15m" value={formatPercent(outbound15)} color={otpColor(outbound15)} hint={`${formatInt(data.outbound.tripsOperated)} trips`} />
          </Row>
        ) : (
          <EmptyState title="No data yet" hint="Directional on-time rates appear once the live feed has recorded trips." />
        )}
      </Card>

      <Card title="Delay distribution" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
        <DelayHistogram distribution={data.overall.delayDistribution} />
      </Card>
    </>
  );
}

function DelayPropagation({ id, range }: { id: string; range: Range }) {
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  return (
    <Card
      title="Where delay accumulates"
      subtitle="Average arrival delay at each stop along the route, in running order"
      right={
        <SegmentedControl
          value={direction}
          onChange={setDirection}
          options={[
            { key: "inbound", label: "Inbound" },
            { key: "outbound", label: "Outbound" },
          ]}
        />
      }
    >
      {/* Inside the card, so switching direction never removes the toggle. */}
      <QueryBoundary pending={<Loading />}>
        <PropagationBody id={id} range={range} direction={direction} />
      </QueryBoundary>
    </Card>
  );
}

function PropagationBody({ id, range, direction }: { id: string; range: Range; direction: "inbound" | "outbound" }) {
  const { data } = useApi(api.linePropagation(id, range, direction));
  return (
    <>
      {data.netAccumulatedSeconds !== null ? (
        <Row>
          <StatTile
            label="Net, end to end"
            value={formatDelayShort(data.netAccumulatedSeconds)}
            color={data.netAccumulatedSeconds > 0 ? theme.colors.bad : theme.colors.good}
            accent={data.netAccumulatedSeconds > 0 ? theme.colors.bad : theme.colors.good}
            hint={data.netAccumulatedSeconds > 0 ? "delay gained over the route" : "delay recovered over the route"}
          />
        </Row>
      ) : null}
      <PropagationChart stops={data.stops} />
      {data.worstSegments.length > 0 ? (
        <>
          <SectionTitle>Costliest stretches</SectionTitle>
          <Table
            columns={[
              { key: "seg", label: "Segment", flex: 3 },
              { key: "added", label: "Adds", align: "right" },
            ]}
            rows={data.worstSegments.map((s) => ({
              seg: `${s.fromStopName} → ${s.toStopName}`,
              added: `+${formatDelaySeconds(s.addedSeconds)}`.replace(" late", ""),
            }))}
          />
        </>
      ) : null}
    </>
  );
}

function CancellationCauses({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineSummary(id, range));
  const causes = data.njtCancellations;
  if (!causes || causes.byCause.length === 0) return null;

  return (
    <Card>
      <SectionTitle>Why NJT cancels trains on this line</SectionTitle>
      <Muted>
        {formatInt(causes.total)} cancellations over {causes.monthsCovered} month(s), by NJT's own cause category.
      </Muted>
      <Table
        columns={[
          { key: "cause", label: "Cause", flex: 2.2 },
          { key: "count", label: "Count", align: "right" },
          { key: "pct", label: "Share", align: "right" },
        ]}
        rows={causes.byCause.map((cause) => ({ cause: cause.cause, count: cause.count, pct: `${cause.percent}%` }))}
      />
    </Card>
  );
}

function OtpTrend({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineTrend(id, range, "daily"));
  const collectionStartDate = useCollectionStart();
  const c = useChartColors();
  const njtValues = data.points.map((p) => p.njtOfficialOtpPercent ?? 0);
  const hasNjt = njtValues.some((v) => v > 0);

  return (
    <Card title="OTP trend (≤15 min vs. NJT 6 min)" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
      {data.points.length > 0 ? (
        <LineChart
          series={[
            { label: "This project ≤15 min", color: c.accent, values: data.points.map((p) => p.otpPercent15Min) },
            ...(hasNjt ? [{ label: "NJT 6 min", color: c.njt, values: njtValues, dashed: true }] : []),
          ]}
        />
      ) : (
        <EmptyState title="No data yet" hint="A daily OTP trend appears once the live feed has recorded trips for this period." />
      )}
    </Card>
  );
}

function PublishedHistory({ id }: { id: string }) {
  const njtMonthly = useNjtMonthly(id);
  const c = useChartColors();
  const hasAdj = njtMonthly.some((r) => r.njtOtpPercentAmtrakAdjusted !== null);

  return (
    <Card>
      <SectionTitle>NJT on-time performance over time (real, 2017→)</SectionTitle>
      {njtMonthly.length > 0 ? (
        <>
          <LineChart
            height={200}
            series={[
              { label: "NJT 6 min OTP", color: c.njt, values: njtMonthly.map((r) => r.njtOtpPercent as number) },
              ...(hasAdj
                ? [
                    {
                      label: "Excl. Amtrak",
                      color: c.accent,
                      values: njtMonthly.map((r) => r.njtOtpPercentAmtrakAdjusted ?? (r.njtOtpPercent as number)),
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
          <Muted>
            {njtMonthly.length} months of NJT’s published OTP ({formatMonth(`${njtMonthly[0]?.month}-01`)} →{" "}
            {formatMonth(`${njtMonthly.at(-1)?.month}-01`)}).
          </Muted>
        </>
      ) : (
        <Muted>No NJT history for this line.</Muted>
      )}
    </Card>
  );
}

function AnnualHistory({ id }: { id: string }) {
  const { data } = useApi(api.lineHistory(id));
  if (data.annual.length === 0) return null;
  return (
    <Card>
      <SectionTitle>NJT on-time history</SectionTitle>
      <HistoryCharts history={data} />
      <Muted>Real NJT figures across all published years — seasonality (winters run worse) and the long-term trend.</Muted>
    </Card>
  );
}

function MonthlyComparison({ id }: { id: string }) {
  const { data } = useApi(api.lineMonthly(id));
  return (
    <Card>
      <SectionTitle>Monthly comparison — this project vs. NJT</SectionTitle>
      <Table
        columns={[
          { key: "month", label: "Month", flex: 1.4 },
          { key: "project", label: "This project ≤15m", align: "right", flex: 1.4 },
          { key: "njt", label: "NJT 6m", align: "right" },
          { key: "njtAdj", label: "NJT adj.", align: "right" },
        ]}
        rows={data.rows.map((r) => ({
          month: formatMonth(`${r.month}-01`),
          project: formatPercent(r.projectOtpPercent15Min),
          njt: formatPercent(r.njtOtpPercent),
          njtAdj: formatPercent(r.njtOtpPercentAmtrakAdjusted),
        }))}
      />
      <Muted>NJT figures are real and published monthly back to 2017; the project column appears once independent data has been collected for a month.</Muted>
    </Card>
  );
}

function WorstTrips({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineWorst(id, range, 10));
  const collectionStartDate = useCollectionStart();
  return (
    <Card title="Most delayed trips" right={<LiveBadge collectionStartDate={collectionStartDate} />}>
      {data.trips.length > 0 ? (
        <Table
          columns={[
            { key: "tripId", label: "Trip", flex: 1.4 },
            { key: "direction", label: "Dir" },
            { key: "delay", label: "Avg terminal delay", align: "right", flex: 1.4 },
            { key: "obs", label: "Obs", align: "right" },
          ]}
          rows={data.trips.map((t) => ({
            tripId: t.tripId,
            direction: t.direction,
            delay: formatDelaySeconds(t.avgTerminalDelaySeconds),
            obs: t.observations,
          }))}
        />
      ) : (
        <EmptyState title="No data yet" hint="Worst-trip rankings appear once the live feed has recorded trips for this period." />
      )}
    </Card>
  );
}

function AmtrakAttribution({ id, range }: { id: string; range: Range }) {
  const { data } = useApi(api.lineSummary(id, range));
  const official = data.njtOfficial;
  if (official?.otpPercentAmtrakAdjusted == null) return null;
  const amtrakCancel = data.njtCancellations?.byCause.find((c) => c.cause.toUpperCase() === "AMTRAK") ?? null;

  return (
    <Card>
      <SectionTitle>Amtrak attribution</SectionTitle>
      <Row>
        <StatTile label="NJT OTP (6 min)" value={formatPercent(official.otpPercent)} />
        <StatTile label="Excluding Amtrak" value={formatPercent(official.otpPercentAmtrakAdjusted)} color={theme.colors.good} />
        <StatTile
          label="Attributed to Amtrak"
          value={`+${Math.round((official.otpPercentAmtrakAdjusted - official.otpPercent) * 10) / 10} pts`}
          color={theme.colors.njt}
          hint="OTP recovered when Amtrak delays are excluded"
        />
      </Row>
      {amtrakCancel ? (
        <Muted>
          Amtrak also caused {amtrakCancel.percent}% of cancellations ({formatInt(amtrakCancel.count)} of{" "}
          {formatInt(data.njtCancellations?.total ?? 0)}) this period.
        </Muted>
      ) : null}
      <Muted>
        On the NEC and North Jersey Coast Line, NJT shares Amtrak-owned track and attributes some delay to it.
        Attribution is NJT’s own.
      </Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  report: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    ...theme.shadow.card,
  },
  reportMain: { flex: 1, gap: 2 },
  reportOtp: { color: theme.colors.text, fontSize: theme.fontSize.xl, fontWeight: "800", letterSpacing: -0.5 },
  reportTrend: { alignItems: "flex-end", gap: 3 },
  vsLabel: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },
});
