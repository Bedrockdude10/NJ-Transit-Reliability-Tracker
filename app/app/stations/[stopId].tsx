import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatDelaySeconds, formatPercent } from "../../lib/format";
import { theme } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { CsvExportButton } from "../../components/CsvExportButton";
import { Heatmap } from "../../components/charts/Heatmap";
import { DelayHistogram } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

export default function StationDetail() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const id = stopId ?? "";
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);

  const summary = useApi(() => api.stationSummary(id, range), [id, range.from, range.to]);
  const topTrips = useApi(() => api.stationTopTrips(id, range), [id, range.from, range.to]);

  return (
    <Screen>
      <PageTitle title={summary.data?.stopName ?? id} subtitle="Station reliability detail" />
      <Row>
        <WindowPicker
          value={windowKey}
          onChange={(key, d) => {
            setWindowKey(key);
            setDays(d);
          }}
        />
        <CsvExportButton url={api.exportUrl("station", range, id)} />
      </Row>

      {summary.loading ? <Loading /> : null}
      {summary.error ? <ErrorView message={summary.error} onRetry={summary.reload} /> : null}

      {summary.data ? (
        <>
          <Card>
            <SectionTitle>Delay amplification</SectionTitle>
            <Row>
              <StatTile label="Arrived within 5 min" value={String(summary.data.amplification.arrivedWithin5Min)} />
              <StatTile label="…then departed late" value={String(summary.data.amplification.departedLate)} color={theme.colors.warn} />
              <StatTile
                label="Amplification rate"
                value={formatPercent(summary.data.amplification.amplificationRatePercent)}
                color={theme.colors.bad}
              />
            </Row>
            <Muted>Of trains arriving roughly on time here, the share that then run late onward — a sign of dwell/crew issues.</Muted>
          </Card>

          <Card>
            <SectionTitle>Average arrival delay by line & direction</SectionTitle>
            <Table
              columns={[
                { key: "line", label: "Line", flex: 2 },
                { key: "dir", label: "Dir" },
                { key: "delay", label: "Avg delay", align: "right", flex: 1.4 },
                { key: "obs", label: "Obs", align: "right" },
              ]}
              rows={summary.data.byLineDirection.map((r) => ({
                line: r.lineName,
                dir: r.direction,
                delay: formatDelaySeconds(r.avgArrivalDelaySeconds),
                obs: r.observations,
              }))}
            />
          </Card>

          <Card>
            <SectionTitle>Arrival delay distribution</SectionTitle>
            <DelayHistogram distribution={summary.data.delayDistribution} />
          </Card>

          <Card>
            <SectionTitle>Delay by hour of day</SectionTitle>
            <Heatmap cells={summary.data.hourOfDay.map((b) => ({ label: b.label.replace(":00", ""), value: b.avgDelaySeconds, observations: b.observations }))} />
          </Card>
        </>
      ) : null}

      <Card>
        <SectionTitle>Most delayed trips through this station</SectionTitle>
        {topTrips.data ? (
          <Table
            columns={[
              { key: "tripId", label: "Trip", flex: 1.6 },
              { key: "line", label: "Line", flex: 1.6 },
              { key: "delay", label: "Avg delay", align: "right", flex: 1.2 },
            ]}
            rows={topTrips.data.trips.map((t) => ({ tripId: t.tripId, line: t.lineName, delay: formatDelaySeconds(t.avgTerminalDelaySeconds) }))}
          />
        ) : (
          <Loading />
        )}
      </Card>
    </Screen>
  );
}
