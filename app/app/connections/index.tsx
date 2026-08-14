import { OTP_GOOD_THRESHOLD_PERCENT, type ConnectionTopItem } from "@njt/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type DateRange } from "../../lib/api";
import { hasConnectionData } from "../../lib/measurement";
import { theme } from "../../lib/theme";
import { useWindow } from "../../hooks/useWindow";
import { useApi } from "../../hooks/useApi";
import { DelayHistogram } from "../../components/metrics";
import { LiveBanner } from "../../components/Indicators";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { QueryBoundary } from "../../components/QueryBoundary";
import { Badge, Card, EmptyState, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Connections() {
  const { key: windowKey, range, select: selectWindow } = useWindow("90d");
  const [selected, setSelected] = useState<ConnectionTopItem | null>(null);

  return (
    <Screen>
      <PageTitle title="Connection Reliability" subtitle="How often a timed transfer actually works" />
      <QueryBoundary>
        <CollectionBanner />
      </QueryBoundary>
      <WindowPicker
        value={windowKey}
        onChange={selectWindow}
      />

      <QueryBoundary>
        <TransferList selected={selected} onSelect={setSelected} />
      </QueryBoundary>

      {selected ? (
        <QueryBoundary>
          <TransferDetail selected={selected} range={range} />
        </QueryBoundary>
      ) : (
        <Muted>Select a transfer above to see its reliability.</Muted>
      )}
    </Screen>
  );
}

function CollectionBanner() {
  const { data } = useApi(api.health());
  return (
    <LiveBanner collectionStartDate={data.collectionStartDate}>
      Connection reliability is measured from the live GTFS-Realtime feed — transfer outcomes accrue as trains
      are observed.
    </LiveBanner>
  );
}

function TransferList({ selected, onSelect }: { selected: ConnectionTopItem | null; onSelect: (t: ConnectionTopItem) => void }) {
  const { data } = useApi(api.connectionsTop(10));

  return (
    <Card>
      <SectionTitle>Highest-frequency transfers</SectionTitle>
      {data.transfers.length === 0 ? (
        <EmptyState title="No data yet" hint="Frequent transfers appear once the live feed has observed connecting trains." />
      ) : null}
      {data.transfers.map((t) => {
        const active =
          selected?.inboundTripId === t.inboundTripId &&
          selected?.outboundTripId === t.outboundTripId &&
          selected?.transferStopId === t.transferStopId;
        return (
          <Pressable
            key={`${t.inboundTripId}|${t.transferStopId}|${t.outboundTripId}`}
            onPress={() => onSelect(t)}
            style={[styles.option, active && styles.optionActive]}
          >
            <View style={styles.optionMain}>
              <Text style={styles.optionTitle}>
                {t.inboundTripId} → {t.outboundTripId}
              </Text>
              <Muted>at {t.transferStopName}</Muted>
            </View>
            <Badge text={`${t.observations} obs`} />
          </Pressable>
        );
      })}
    </Card>
  );
}

function TransferDetail({ selected, range }: { selected: ConnectionTopItem; range: Required<DateRange> }) {
  const { data } = useApi(
    api.connections({
      inbound_trip_id: selected.inboundTripId,
      transfer_stop_id: selected.transferStopId,
      outbound_trip_id: selected.outboundTripId,
      ...range,
    }),
  );

  return (
    <Card>
      <SectionTitle>
        {selected.inboundTripId} → {selected.outboundTripId} at {selected.transferStopName}
      </SectionTitle>
      {!hasConnectionData(data) ? (
        <EmptyState title="No data yet" hint="This transfer has no observed connection attempts for the selected period." />
      ) : (
        <>
          <Row>
            <StatTile
              label="Success rate"
              value={`${data.successRatePercent}%`}
              color={data.successRatePercent >= OTP_GOOD_THRESHOLD_PERCENT ? theme.colors.good : theme.colors.warn}
              hint={`${data.observations} observations`}
            />
            <StatTile label="Peak" value={`${data.peak.successRatePercent}%`} hint={`${data.peak.observations} obs`} />
            <StatTile label="Off-peak" value={`${data.offPeak.successRatePercent}%`} hint={`${data.offPeak.observations} obs`} />
          </Row>

          {data.lowSample ? (
            <View style={styles.warn}>
              <Text style={styles.warnText}>⚠ Fewer than 30 observations — treat this as a preliminary estimate.</Text>
            </View>
          ) : null}

          <View style={{ gap: theme.spacing(2) }}>
            <Text style={styles.subhead}>By day of week</Text>
            <Table
              columns={[
                { key: "day", label: "Day" },
                { key: "rate", label: "Success", align: "right" },
                { key: "obs", label: "Obs", align: "right" },
              ]}
              rows={data.byDayOfWeek.map((d) => ({ day: DOW[d.dayOfWeek] ?? String(d.dayOfWeek), rate: `${d.successRatePercent}%`, obs: d.observations }))}
            />
          </View>

          <View style={{ gap: theme.spacing(2) }}>
            <Text style={styles.subhead}>Inbound delay at transfer</Text>
            <DelayHistogram distribution={data.inboundDelayDistribution} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  optionActive: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius },
  optionMain: { gap: 2, flex: 1, paddingHorizontal: theme.spacing(2) },
  optionTitle: { color: theme.colors.text, fontWeight: "600", fontSize: theme.fontSize.sm },
  subhead: { color: theme.colors.text, fontWeight: "700", fontSize: theme.fontSize.md },
  warn: { backgroundColor: theme.colors.warnSoft, borderRadius: theme.radii.md, padding: theme.spacing(3), borderWidth: 1, borderColor: theme.colors.warn },
  warnText: { color: theme.colors.warn, fontSize: theme.fontSize.sm, fontWeight: "600" },
});
