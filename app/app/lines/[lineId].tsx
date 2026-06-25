import type { TrendPoint } from "@njt/shared";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatDelaySeconds, formatInt, formatMonth, formatPercent } from "../../lib/format";
import { theme, otpColor } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { CsvExportButton } from "../../components/CsvExportButton";
import { LineChart } from "../../components/charts/LineChart";
import { DelayHistogram, GapCallout, OtpComparison } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

/** Group daily trend points into a monthly project-vs-NJT comparison. */
function monthlyComparison(points: readonly TrendPoint[]) {
  const byMonth = new Map<string, { sum: number; count: number; njt: number | null }>();
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const acc = byMonth.get(key) ?? { sum: 0, count: 0, njt: null };
    acc.sum += p.otpPercent15Min;
    acc.count += 1;
    if (p.njtOfficialOtpPercent !== null) acc.njt = p.njtOfficialOtpPercent;
    byMonth.set(key, acc);
  }
  return [...byMonth.entries()].map(([month, a]) => ({
    month: formatMonth(`${month}-01`),
    project: `${Math.round((a.sum / a.count) * 10) / 10}%`,
    njt: a.njt === null ? "—" : `${a.njt}%`,
  }));
}

export default function LineDetail() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const id = lineId ?? "";
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);

  const summary = useApi(() => api.lineSummary(id, range), [id, range.from, range.to]);
  const trend = useApi(() => api.lineTrend(id, range, "daily"), [id, range.from, range.to]);
  const worst = useApi(() => api.lineWorst(id, range, 10), [id, range.from, range.to]);

  const njtValues = trend.data?.points.map((p) => p.njtOfficialOtpPercent ?? 0) ?? [];
  const hasNjt = njtValues.some((v) => v > 0);

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

      {trend.data && trend.data.points.length > 0 ? (
        <Card>
          <SectionTitle>Monthly comparison</SectionTitle>
          <Table
            columns={[
              { key: "month", label: "Month", flex: 1.4 },
              { key: "project", label: "This project ≤15m", align: "right" },
              { key: "njt", label: "NJT 6m", align: "right" },
            ]}
            rows={monthlyComparison(trend.data.points)}
          />
        </Card>
      ) : null}

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
          <Muted>
            NJT reports {summary.data.njtOfficial.otpPercent}% on-time, or {summary.data.njtOfficial.otpPercentAmtrakAdjusted}%
            after excluding delays it attributes to Amtrak-owned infrastructure. Attribution is NJT’s own.
          </Muted>
        </Card>
      ) : null}
    </Screen>
  );
}
