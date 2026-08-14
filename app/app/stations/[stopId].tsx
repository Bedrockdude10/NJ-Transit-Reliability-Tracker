import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { formatDelaySeconds, formatPercent } from "../../lib/format";
import { hasHeatmapData, hasStationData } from "../../lib/measurement";
import { theme } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { useLiveApi } from "../../hooks/useLiveApi";
import { useNow } from "../../hooks/useNow";
import { BoardDisclaimer, BoardFreshness, DepartureBoard } from "../../components/DepartureBoard";
import { CsvExportButton } from "../../components/CsvExportButton";
import { LiveBanner } from "../../components/Indicators";
import { Heatmap } from "../../components/charts/Heatmap";
import { DelayHistogram } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, EmptyState, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

/** Matches the pipeline's TripUpdates cadence — polling faster gains nothing. */
const DEPARTURES_REFRESH_MS = 30_000;

export default function StationDetail() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const id = stopId ?? "";
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [days, setDays] = useState(30);
  const range = useMemo(() => windowToRange(days), [days]);

  const summary = useApi(api.stationSummary(id, range));
  const topTrips = useApi(api.stationTopTrips(id, range));
  const health = useApi(api.health());
  const collectionStartDate = health.data?.collectionStartDate ?? null;
  const measured = hasStationData(summary.data);

  // The board polls; the countdown ticks. Keeping them on separate clocks means
  // "3 min" counts down every second without re-fetching every second.
  const departures = useLiveApi(api.stationDepartures(id), DEPARTURES_REFRESH_MS);
  const now = useNow();

  return (
    <Screen>
      <PageTitle title={summary.data?.stopName ?? id} subtitle="Station reliability detail" />

      <Card
        title="Next departures"
        subtitle="Live from NJ Transit's GTFS-Realtime feed"
        right={<BoardFreshness updatedAtMs={departures.updatedAtMs} nowMs={now} />}
      >
        {departures.loading ? <Loading label="Loading board…" /> : null}
        {/* A failed refresh keeps the last board on screen — a blip shouldn't blank it. */}
        {departures.error && !departures.data ? (
          <ErrorView message={departures.error} onRetry={departures.reload} />
        ) : null}
        {departures.data ? (
          <>
            {departures.error ? <Muted>Reconnecting… showing the last update.</Muted> : null}
            <DepartureBoard departures={departures.data.departures} nowMs={now} />
            <View style={{ marginTop: theme.spacing(2) }}>
              <BoardDisclaimer />
            </View>
          </>
        ) : null}
      </Card>

      <LiveBanner collectionStartDate={collectionStartDate}>
        Per-station arrival delays are measured from the live GTFS-Realtime feed. The station name and lines are
        real (from GTFS); reliability figures fill in as data accrues.
      </LiveBanner>
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

      {summary.data && !measured ? (
        <Card>
          <SectionTitle>Station reliability</SectionTitle>
          <EmptyState
            title="No data yet"
            hint="Arrival delays, amplification, and distributions for this station appear once the live feed has recorded trips here."
          />
        </Card>
      ) : null}

      {summary.data && measured ? (
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
            {summary.data.byLineDirection.length > 0 ? (
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
            ) : (
              <EmptyState title="No data yet" />
            )}
          </Card>

          <Card>
            <SectionTitle>Arrival delay distribution</SectionTitle>
            <DelayHistogram distribution={summary.data.delayDistribution} />
          </Card>

          <Card>
            <SectionTitle>Delay by hour of day</SectionTitle>
            {hasHeatmapData(summary.data.hourOfDay) ? (
              <Heatmap cells={summary.data.hourOfDay.map((b) => ({ label: b.label.replace(":00", ""), value: b.avgDelaySeconds, observations: b.observations }))} />
            ) : (
              <EmptyState title="No data yet" />
            )}
          </Card>
        </>
      ) : null}

      {measured ? (
        <Card>
          <SectionTitle>Most delayed trips through this station</SectionTitle>
          {!topTrips.data ? (
            <Loading />
          ) : topTrips.data.trips.length > 0 ? (
            <Table
              columns={[
                { key: "tripId", label: "Trip", flex: 1.6 },
                { key: "line", label: "Line", flex: 1.6 },
                { key: "delay", label: "Avg delay", align: "right", flex: 1.2 },
              ]}
              rows={topTrips.data.trips.map((t) => ({ tripId: t.tripId, line: t.lineName, delay: formatDelaySeconds(t.avgTerminalDelaySeconds) }))}
            />
          ) : (
            <EmptyState title="No data yet" />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
