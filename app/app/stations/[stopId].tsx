import { useLocalSearchParams } from "expo-router";

import { View } from "react-native";
import { api, type DateRange } from "../../lib/api";
import { formatDelaySeconds, formatPercent } from "../../lib/format";
import { hasHeatmapData, hasStationData } from "../../lib/measurement";
import { theme } from "../../lib/theme";
import { useWindow } from "../../hooks/useWindow";
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
import { QueryBoundary } from "../../components/QueryBoundary";
import { Card, EmptyState, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

/** Matches the pipeline's TripUpdates cadence — polling faster gains nothing. */
const DEPARTURES_REFRESH_MS = 30_000;

export default function StationDetail() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const id = stopId ?? "";
  const { key: windowKey, range, select: selectWindow } = useWindow();

  return (
    <Screen>
      <QueryBoundary pending={<PageTitle title={id} subtitle="Station reliability detail" />}>
        <StationHeading id={id} range={range} />
      </QueryBoundary>

      <QueryBoundary pending={<Loading label="Loading board…" />}>
        <LiveBoard id={id} />
      </QueryBoundary>

      <QueryBoundary>
        <CollectionBanner />
      </QueryBoundary>

      <Row>
        <WindowPicker value={windowKey} onChange={selectWindow} />
        <CsvExportButton url={api.exportUrl("station", range, id)} />
      </Row>

      <QueryBoundary>
        <StationReliability id={id} range={range} />
      </QueryBoundary>
    </Screen>
  );
}

function StationHeading({ id, range }: { id: string; range: Required<DateRange> }) {
  const { data } = useApi(api.stationSummary(id, range));
  return <PageTitle title={data.stopName} subtitle="Station reliability detail" />;
}

function CollectionBanner() {
  const { data } = useApi(api.health());
  return (
    <LiveBanner collectionStartDate={data.collectionStartDate}>
      Per-station arrival delays are measured from the live GTFS-Realtime feed. The station name and lines are
      real (from GTFS); reliability figures fill in as data accrues.
    </LiveBanner>
  );
}

function LiveBoard({ id }: { id: string }) {
  // Separate clocks: "3 min" ticks every second without refetching every second.
  const { data, error, updatedAtMs } = useLiveApi(api.stationDepartures(id), DEPARTURES_REFRESH_MS);
  const now = useNow();

  return (
    <Card
      title="Next departures"
      subtitle="Live from NJ Transit's GTFS-Realtime feed"
      right={<BoardFreshness updatedAtMs={updatedAtMs} nowMs={now} />}
    >
      {/* A failed refresh keeps the last board on screen — a blip shouldn't
          blank it. That is the query client's `throwOnError` predicate: only a
          first load with nothing to show reaches the boundary. */}
      {error ? <Muted>Reconnecting… showing the last update.</Muted> : null}
      <DepartureBoard departures={data.departures} nowMs={now} />
      <View style={{ marginTop: theme.spacing(2) }}>
        <BoardDisclaimer />
      </View>
    </Card>
  );
}

function StationReliability({ id, range }: { id: string; range: Required<DateRange> }) {
  const { data } = useApi(api.stationSummary(id, range));
  const measured = hasStationData(data);

  if (!measured) {
    return (
      <Card>
        <SectionTitle>Station reliability</SectionTitle>
        <EmptyState
          title="No data yet"
          hint="Arrival delays, amplification, and distributions for this station appear once the live feed has recorded trips here."
        />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <SectionTitle>Delay amplification</SectionTitle>
        <Row>
          <StatTile label="Arrived within 5 min" value={String(data.amplification.arrivedWithin5Min)} />
          <StatTile label="…then departed late" value={String(data.amplification.departedLate)} color={theme.colors.warn} />
          <StatTile
            label="Amplification rate"
            value={formatPercent(data.amplification.amplificationRatePercent)}
            color={theme.colors.bad}
          />
        </Row>
        <Muted>Of trains arriving roughly on time here, the share that then run late onward — a sign of dwell/crew issues.</Muted>
      </Card>

      <Card>
        <SectionTitle>Average arrival delay by line &amp; direction</SectionTitle>
        {data.byLineDirection.length > 0 ? (
          <Table
            columns={[
              { key: "line", label: "Line", flex: 2 },
              { key: "dir", label: "Dir" },
              { key: "delay", label: "Avg delay", align: "right", flex: 1.4 },
              { key: "obs", label: "Obs", align: "right" },
            ]}
            rows={data.byLineDirection.map((r) => ({
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
        <DelayHistogram distribution={data.delayDistribution} />
      </Card>

      <Card>
        <SectionTitle>Delay by hour of day</SectionTitle>
        {hasHeatmapData(data.hourOfDay) ? (
          <Heatmap cells={data.hourOfDay.map((b) => ({ label: b.label.replace(":00", ""), value: b.avgDelaySeconds, observations: b.observations }))} />
        ) : (
          <EmptyState title="No data yet" />
        )}
      </Card>

      <QueryBoundary>
        <TopDelayedTrips id={id} range={range} />
      </QueryBoundary>
    </>
  );
}

function TopDelayedTrips({ id, range }: { id: string; range: Required<DateRange> }) {
  const { data } = useApi(api.stationTopTrips(id, range));
  return (
    <Card>
      <SectionTitle>Most delayed trips through this station</SectionTitle>
      {data.trips.length > 0 ? (
        <Table
          columns={[
            { key: "tripId", label: "Trip", flex: 1.6 },
            { key: "line", label: "Line", flex: 1.6 },
            { key: "delay", label: "Avg delay", align: "right", flex: 1.2 },
          ]}
          rows={data.trips.map((t) => ({ tripId: t.tripId, line: t.lineName, delay: formatDelaySeconds(t.avgTerminalDelaySeconds) }))}
        />
      ) : (
        <EmptyState title="No data yet" />
      )}
    </Card>
  );
}
