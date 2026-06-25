import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { formatDelaySeconds, formatInt, formatPercent } from "../lib/format";
import { otpColor, theme } from "../lib/theme";
import { windowToRange, type WindowKey } from "../lib/windows";
import { useApi } from "../hooks/useApi";
import { CsvExportButton } from "../components/CsvExportButton";
import { Heatmap } from "../components/charts/Heatmap";
import { DelayHistogram, GapCallout, OtpComparison } from "../components/metrics";
import { HistoryCharts } from "../components/HistoryCharts";
import { Table } from "../components/Table";
import { WindowPicker } from "../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../components/ui";

export default function SystemOverview() {
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);

  const summary = useApi(() => api.systemSummary(range), [range.from, range.to]);
  const dow = useApi(() => api.systemHeatmap(range, "day_of_week"), [range.from, range.to]);
  const hour = useApi(() => api.systemHeatmap(range, "hour_of_day"), [range.from, range.to]);
  const history = useApi(() => api.systemHistory(), []);
  const lines = useApi(() => api.lines(), []);

  const ranked = (lines.data?.lines ?? [])
    .filter((l) => l.njtOtpPercent !== null)
    .sort((a, b) => (b.njtOtpPercent ?? 0) - (a.njtOtpPercent ?? 0));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return (
    <Screen>
      <PageTitle title="System Overview" subtitle="NJ Transit commuter rail — independently measured reliability" />
      <Row>
        <WindowPicker
          value={windowKey}
          onChange={(key, d) => {
            setWindowKey(key);
            setDays(d);
          }}
        />
        <CsvExportButton url={api.exportUrl("system", range)} />
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
            <StatTile label="Cancellation rate" value={formatPercent(summary.data.overall.cancellationRatePercent)} />
            <StatTile label="Median delay" value={formatDelaySeconds(summary.data.overall.medianDelaySeconds)} />
            <StatTile label="P90 delay" value={formatDelaySeconds(summary.data.overall.p90DelaySeconds)} color={theme.colors.warn} />
            {summary.data.fleetMdbf ? (
              <StatTile label="Fleet MDBF" value={`${formatInt(summary.data.fleetMdbf.avgMiles)} mi`} hint="miles between failures (NJT)" />
            ) : null}
          </Row>

          {best && worst && best.id !== worst.id ? (
            <Row>
              <StatTile label="Most reliable line (NJT, latest)" value={`${best.shortName} · ${formatPercent(best.njtOtpPercent)}`} color={otpColor(best.njtOtpPercent ?? 0)} hint={best.name} />
              <StatTile label="Least reliable line (NJT, latest)" value={`${worst.shortName} · ${formatPercent(worst.njtOtpPercent)}`} color={otpColor(worst.njtOtpPercent ?? 0)} hint={worst.name} />
            </Row>
          ) : null}

          <Card>
            <SectionTitle>On-time performance vs. NJT</SectionTitle>
            <OtpComparison thresholds={summary.data.overall.thresholds} njtOfficial={summary.data.njtOfficial} />
          </Card>

          <Card>
            <SectionTitle>Delay distribution</SectionTitle>
            <DelayHistogram distribution={summary.data.overall.delayDistribution} />
          </Card>

          {summary.data.njtCancellations && summary.data.njtCancellations.byCause.length > 0 ? (
            <Card>
              <SectionTitle>Why NJT cancels trains (system-wide)</SectionTitle>
              <Muted>
                {formatInt(summary.data.njtCancellations.total)} cancellations over {summary.data.njtCancellations.monthsCovered} month(s),
                by NJT’s own cause category.
              </Muted>
              <Table
                columns={[
                  { key: "cause", label: "Cause", flex: 2.2 },
                  { key: "count", label: "Count", align: "right" },
                  { key: "pct", label: "Share", align: "right" },
                ]}
                rows={summary.data.njtCancellations.byCause.slice(0, 8).map((cause) => ({
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
        <SectionTitle>Average delay by day of week</SectionTitle>
        {dow.data ? (
          <Heatmap cells={dow.data.buckets.map((b) => ({ label: b.label, value: b.avgDelaySeconds, observations: b.observations }))} />
        ) : (
          <Loading />
        )}
      </Card>

      <Card>
        <SectionTitle>Average delay by hour of day</SectionTitle>
        {hour.data ? (
          <Heatmap cells={hour.data.buckets.map((b) => ({ label: b.label.replace(":00", ""), value: b.avgDelaySeconds, observations: b.observations }))} />
        ) : (
          <Loading />
        )}
      </Card>

      {history.data && history.data.annual.length > 0 ? (
        <Card>
          <SectionTitle>NJT on-time history (system)</SectionTitle>
          <HistoryCharts history={history.data} />
        </Card>
      ) : null}
    </Screen>
  );
}
