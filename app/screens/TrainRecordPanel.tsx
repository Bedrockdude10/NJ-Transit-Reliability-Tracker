import type { TrainRunResult, WorstTrip } from "@njt/shared";
import { OTP_STRICT_THRESHOLD_SECONDS } from "@njt/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { QueryBoundary } from "../components/QueryBoundary";
import { Table } from "../components/Table";
import { Badge, Card, EmptyState, Muted, PageTitle, Row, SectionTitle, StatTile } from "../components/ui";
import { WindowPicker } from "../components/WindowPicker";
import { useApi } from "../hooks/useApi";
import { useWindow } from "../hooks/useWindow";
import { api, type DateRange } from "../lib/api";
import { formatDelayShort, formatPercent, formatShortDate } from "../lib/format";
import { theme } from "../lib/theme";

/**
 * One departure's own punctuality history, after Deutsche Bahn's per-train
 * record: not how the line does, but how *this* train does.
 */
export function TrainRecordPanel() {
  const { key: windowKey, range, select } = useWindow("90d");
  const [trip, setTrip] = useState<WorstTrip | null>(null);

  return (
    <>
      <PageTitle
        title="Train record"
        subtitle="How often one scheduled departure is actually late, run by run"
      />
      <WindowPicker value={windowKey} onChange={select} />
      <QueryBoundary>
        <TripChoices selected={trip} onSelect={setTrip} range={range} />
      </QueryBoundary>
      {trip === null ? (
        <Muted>Select a departure above to see its record.</Muted>
      ) : (
        <QueryBoundary>
          <Record trip={trip} range={range} />
        </QueryBoundary>
      )}
    </>
  );
}

function TripChoices({
  selected,
  onSelect,
  range,
}: {
  selected: WorstTrip | null;
  onSelect: (trip: WorstTrip) => void;
  range: DateRange;
}) {
  const { data } = useApi(api.stationRankings(range, "delay"));
  const worstStation = data.stations[0];
  return worstStation === undefined ? (
    <EmptyState title="No departures yet" hint="Records appear once the live feed has observed trains." />
  ) : (
    <QueryBoundary>
      <StationTrips stopId={worstStation.stopId} selected={selected} onSelect={onSelect} range={range} />
    </QueryBoundary>
  );
}

function StationTrips({
  stopId,
  selected,
  onSelect,
  range,
}: {
  stopId: string;
  selected: WorstTrip | null;
  onSelect: (trip: WorstTrip) => void;
  range: DateRange;
}) {
  const { data } = useApi(api.stationTopTrips(stopId, range));
  return (
    <Card>
      <SectionTitle>Departures worth checking</SectionTitle>
      {data.trips.length === 0 ? (
        <EmptyState title="No departures yet" hint="Records appear once the live feed has observed trains." />
      ) : null}
      {data.trips.map((t) => (
        <Pressable
          key={t.tripId}
          onPress={() => onSelect(t)}
          style={[styles.choice, selected?.tripId === t.tripId && styles.choiceActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: selected?.tripId === t.tripId }}
        >
          <Text style={styles.choiceText}>
            {t.lineName} · {t.tripId} · to {t.terminalStopName}
          </Text>
          <Text style={styles.choiceMeta}>{formatDelayShort(t.avgTerminalDelaySeconds)} avg</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const COLUMNS = [
  { key: "threshold", label: "On time within", flex: 2 },
  { key: "percent", label: "Share of runs", align: "right" as const },
];

function runLabel(run: TrainRunResult): string {
  if (run.cancelled) return "cancelled";
  return run.delaySeconds === null ? "—" : formatDelayShort(run.delaySeconds);
}

function runColor(run: TrainRunResult): string {
  if (run.cancelled) return theme.colors.bad;
  if (run.delaySeconds === null) return theme.colors.textFaint;
  return run.delaySeconds > OTP_STRICT_THRESHOLD_SECONDS ? theme.colors.warn : theme.colors.good;
}

function Record({ trip, range }: { trip: WorstTrip; range: DateRange }) {
  const { data } = useApi(api.trainRecord(trip.tripId, { ...range }));

  return (
    <Card>
      <View style={styles.header}>
        <SectionTitle>
          {data.lineName} · {data.tripId}
        </SectionTitle>
        {data.lowSample ? <Badge text="Preliminary" color={theme.colors.warn} tint={theme.colors.warnSoft} /> : null}
      </View>
      <Muted>
        {data.originStopName} to {data.terminalStopName}, measured on arrival at {data.measuredAtStopName}
      </Muted>

      <Row>
        <StatTile
          label="Late over 5 min"
          value={formatPercent(data.latePercent)}
          hint={`${data.runs} runs observed`}
        />
        <StatTile
          label="Typical delay"
          value={data.medianDelaySeconds === null ? "—" : formatDelayShort(data.medianDelaySeconds)}
          hint="median"
        />
        <StatTile
          label="Plan around"
          value={data.p90DelaySeconds === null ? "—" : formatDelayShort(data.p90DelaySeconds)}
          hint="9 runs in 10 beat this"
        />
        <StatTile label="Cancelled" value={String(data.cancellations)} hint="in this window" />
      </Row>

      <SectionTitle>Recent runs</SectionTitle>
      <View style={styles.strip}>
        {data.recentRuns.map((run) => (
          <View key={run.serviceDate} style={styles.run}>
            <Text style={[styles.runValue, { color: runColor(run) }]}>{runLabel(run)}</Text>
            <Text style={styles.runDate}>{formatShortDate(run.serviceDate)}</Text>
          </View>
        ))}
      </View>

      <Table
        columns={COLUMNS}
        rows={data.onTime.map((t) => ({
          threshold: formatDelayShort(t.thresholdSeconds),
          percent: formatPercent(t.onTimePercent),
        }))}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  choice: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing(2),
  },
  choiceActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  choiceText: { color: theme.colors.text, fontSize: theme.fontSize.sm, flexShrink: 1 },
  choiceMeta: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  run: {
    alignItems: "center",
    paddingVertical: theme.spacing(1),
    paddingHorizontal: theme.spacing(2),
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: 62,
  },
  runValue: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold },
  runDate: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },
});
