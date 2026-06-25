import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatDelaySeconds, formatInt, formatMonth, formatPercent } from "../../lib/format";
import { theme, otpColor } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { CsvExportButton } from "../../components/CsvExportButton";
import { LineChart } from "../../components/charts/LineChart";
import { HistoryCharts } from "../../components/HistoryCharts";
import { DelayHistogram, GapCallout, OtpComparison } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

export default function LineDetail() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const id = lineId ?? "";
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);

  const summary = useApi(() => api.lineSummary(id, range), [id, range.from, range.to]);
  const trend = useApi(() => api.lineTrend(id, range, "daily"), [id, range.from, range.to]);
  const worst = useApi(() => api.lineWorst(id, range, 10), [id, range.from, range.to]);
  const monthly = useApi(() => api.lineMonthly(id), [id]);
  const history = useApi(() => api.lineHistory(id), [id]);

  const njtValues = trend.data?.points.map((p) => p.njtOfficialOtpPercent ?? 0) ?? [];
  const hasNjt = njtValues.some((v) => v > 0);

  // Real, long-run NJT OTP history (chronological), from the monthly endpoint.
  const njtMonthly = (monthly.data?.rows ?? []).filter((r) => r.njtOtpPercent !== null).reverse();
  const njtMonthlyHasAdj = njtMonthly.some((r) => r.njtOtpPercentAmtrakAdjusted !== null);
  const amtrakCancel = summary.data?.njtCancellations?.byCause.find((c) => c.cause.toUpperCase() === "AMTRAK") ?? null;

  return (
    <Screen>
      <PageTitle title={summary.data?.name ?? id} subtitle="Line reliability detail" />
      <Row>
        <WindowPicker
          value={windowKey}
          onChange={(key, d) => {
            setWindowKey(key);
            setDays(d);
          }}
        />
        <CsvExportButton url={api.exportUrl("line", range, id)} />
      </Row>

      {summary.loading ? <Loading /> : null}
      {summary.error ? <ErrorView message={summary.error} onRetry={summary.reload} /> : null}

      {summary.data ? (
        <>
          <GapCallout
            strictPercent={summary.data.overall.thresholds[0]?.otpPercent ?? 0}
            njtPercent={summary.data.njtOfficial?.otpPercent ?? null}
          />

          <Row>
            <StatTile label="Trips operated" value={formatInt(summary.data.overall.tripsOperated)} />
            <StatTile label="Cancelled" value={formatInt(summary.data.overall.tripsCancelled)} color={theme.colors.bad} />
            <StatTile label="Avg delay" value={formatDelaySeconds(summary.data.overall.avgDelaySeconds)} />
            <StatTile label="P90 delay" value={formatDelaySeconds(summary.data.overall.p90DelaySeconds)} color={theme.colors.warn} />
          </Row>

          <Card>
            <SectionTitle>On-time performance vs. NJT</SectionTitle>
            <OtpComparison thresholds={summary.data.overall.thresholds} njtOfficial={summary.data.njtOfficial} />
          </Card>

          <Card>
            <SectionTitle>Inbound vs. outbound</SectionTitle>
            <Row>
              <StatTile
                label="Inbound OTP ≤15m"
                value={formatPercent(summary.data.inbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0)}
                color={otpColor(summary.data.inbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0)}
                hint={`${formatInt(summary.data.inbound.tripsOperated)} trips`}
              />
              <StatTile
                label="Outbound OTP ≤15m"
                value={formatPercent(summary.data.outbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0)}
                color={otpColor(summary.data.outbound.thresholds.find((t) => t.thresholdSeconds === 900)?.otpPercent ?? 0)}
                hint={`${formatInt(summary.data.outbound.tripsOperated)} trips`}
              />
            </Row>
          </Card>

          <Card>
            <SectionTitle>Delay distribution</SectionTitle>
            <DelayHistogram distribution={summary.data.overall.delayDistribution} />
          </Card>

          {summary.data.njtCancellations && summary.data.njtCancellations.byCause.length > 0 ? (
            <Card>
              <SectionTitle>Why NJT cancelled trains</SectionTitle>
              <Muted>
                {formatInt(summary.data.njtCancellations.total)} cancellations over {summary.data.njtCancellations.monthsCovered} month(s),
                by NJT’s own cause category. The Amtrak share is what NJT excludes from its “Amtrak-adjusted” figures.
              </Muted>
              <Table
                columns={[
                  { key: "cause", label: "Cause", flex: 2.2 },
                  { key: "count", label: "Count", align: "right" },
                  { key: "pct", label: "Share", align: "right" },
                ]}
                rows={summary.data.njtCancellations.byCause.map((cause) => ({
                  cause: cause.cause,
                  count: cause.count,
                  pct: `${cause.percent}%`,
                }))}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <SectionTitle>OTP trend (≤15 min vs. NJT 6 min)</SectionTitle>
        {trend.data && trend.data.points.length > 0 ? (
          <LineChart
            series={[
              { label: "This project ≤15 min", color: theme.colors.accent, values: trend.data.points.map((p) => p.otpPercent15Min) },
              ...(hasNjt ? [{ label: "NJT 6 min", color: theme.colors.njt, values: njtValues, dashed: true }] : []),
            ]}
          />
        ) : (
          <Muted>No trend data for this period.</Muted>
        )}
      </Card>

      <Card>
        <SectionTitle>NJT on-time performance over time (real, 2017→)</SectionTitle>
        {njtMonthly.length > 0 ? (
          <>
            <LineChart
              height={200}
              series={[
                { label: "NJT 6 min OTP", color: theme.colors.njt, values: njtMonthly.map((r) => r.njtOtpPercent as number) },
                ...(njtMonthlyHasAdj
                  ? [
                      {
                        label: "Excl. Amtrak",
                        color: theme.colors.accent,
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

      {history.data && history.data.annual.length > 0 ? (
        <Card>
          <SectionTitle>NJT on-time history</SectionTitle>
          <HistoryCharts history={history.data} />
          <Muted>Real NJT figures across all published years — seasonality (winters run worse) and the long-term trend.</Muted>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Monthly comparison — this project vs. NJT</SectionTitle>
        {monthly.data ? (
          <>
            <Table
              columns={[
                { key: "month", label: "Month", flex: 1.4 },
                { key: "project", label: "This project ≤15m", align: "right", flex: 1.4 },
                { key: "njt", label: "NJT 6m", align: "right" },
                { key: "njtAdj", label: "NJT adj.", align: "right" },
              ]}
              rows={monthly.data.rows.map((r) => ({
                month: formatMonth(`${r.month}-01`),
                project: formatPercent(r.projectOtpPercent15Min),
                njt: formatPercent(r.njtOtpPercent),
                njtAdj: formatPercent(r.njtOtpPercentAmtrakAdjusted),
              }))}
            />
            <Muted>NJT figures are real and published monthly back to 2017; the project column appears once independent data has been collected for a month.</Muted>
          </>
        ) : (
          <Loading />
        )}
      </Card>

      <Card>
        <SectionTitle>Most delayed trips</SectionTitle>
        {worst.data ? (
          <Table
            columns={[
              { key: "tripId", label: "Trip", flex: 1.4 },
              { key: "direction", label: "Dir" },
              { key: "delay", label: "Avg terminal delay", align: "right", flex: 1.4 },
              { key: "obs", label: "Obs", align: "right" },
            ]}
            rows={worst.data.trips.map((t) => ({
              tripId: t.tripId,
              direction: t.direction,
              delay: formatDelaySeconds(t.avgTerminalDelaySeconds),
              obs: t.observations,
            }))}
          />
        ) : (
          <Loading />
        )}
      </Card>

      {summary.data?.njtOfficial?.otpPercentAmtrakAdjusted != null ? (
        <Card>
          <SectionTitle>Amtrak attribution</SectionTitle>
          <Row>
            <StatTile label="NJT OTP (6 min)" value={formatPercent(summary.data.njtOfficial.otpPercent)} />
            <StatTile
              label="Excluding Amtrak"
              value={formatPercent(summary.data.njtOfficial.otpPercentAmtrakAdjusted)}
              color={theme.colors.good}
            />
            <StatTile
              label="Attributed to Amtrak"
              value={`+${Math.round((summary.data.njtOfficial.otpPercentAmtrakAdjusted - summary.data.njtOfficial.otpPercent) * 10) / 10} pts`}
              color={theme.colors.njt}
              hint="OTP recovered when Amtrak delays are excluded"
            />
          </Row>
          {amtrakCancel ? (
            <Muted>
              Amtrak also caused {amtrakCancel.percent}% of cancellations ({formatInt(amtrakCancel.count)} of{" "}
              {formatInt(summary.data.njtCancellations?.total ?? 0)}) this period.
            </Muted>
          ) : null}
          <Muted>
            On the NEC and North Jersey Coast Line, NJT shares Amtrak-owned track and attributes some delay to it.
            Attribution is NJT’s own.
          </Muted>
        </Card>
      ) : null}
    </Screen>
  );
}
