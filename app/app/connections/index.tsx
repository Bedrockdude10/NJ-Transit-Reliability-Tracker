import type { ConnectionTopItem } from "@njt/shared";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { theme } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { DelayHistogram } from "../../components/metrics";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Badge, Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Connections() {
  const [windowKey, setWindowKey] = useState<WindowKey>("90d");
  const [days, setDays] = useState(90);
  const range = useMemo(() => windowToRange(days), [days]);
  const [selected, setSelected] = useState<ConnectionTopItem | null>(null);

  const top = useApi(() => api.connectionsTop(10), []);
  const conn = useApi(
    () =>
      selected
        ? api.connections({
            inbound_trip_id: selected.inboundTripId,
            transfer_stop_id: selected.transferStopId,
            outbound_trip_id: selected.outboundTripId,
            ...range,
          })
        : Promise.resolve(null),
    [selected, range.from, range.to],
  );

  return (
    <Screen>
      <PageTitle title="Connection Reliability" subtitle="How often a timed transfer actually works" />
      <WindowPicker
        value={windowKey}
        onChange={(key, d) => {
          setWindowKey(key);
          setDays(d);
        }}
      />

      <Card>
        <SectionTitle>Highest-frequency transfers</SectionTitle>
        {top.loading ? <Loading /> : null}
        {top.error ? <ErrorView message={top.error} onRetry={top.reload} /> : null}
        {top.data?.transfers.map((t) => {
          const active = selected?.inboundTripId === t.inboundTripId && selected?.outboundTripId === t.outboundTripId && selected?.transferStopId === t.transferStopId;
          return (
            <Pressable key={`${t.inboundTripId}|${t.transferStopId}|${t.outboundTripId}`} onPress={() => setSelected(t)} style={[styles.option, active && styles.optionActive]}>
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

      {selected ? (
        <Card>
          <SectionTitle>
            {selected.inboundTripId} → {selected.outboundTripId} at {selected.transferStopName}
          </SectionTitle>
          {conn.loading ? <Loading /> : null}
          {conn.data ? (
            <>
              <Row>
                <StatTile
                  label="Success rate"
                  value={`${conn.data.successRatePercent}%`}
                  color={conn.data.successRatePercent >= 90 ? theme.colors.good : theme.colors.warn}
                  hint={`${conn.data.observations} observations`}
                />
                <StatTile label="Peak" value={`${conn.data.peak.successRatePercent}%`} hint={`${conn.data.peak.observations} obs`} />
                <StatTile label="Off-peak" value={`${conn.data.offPeak.successRatePercent}%`} hint={`${conn.data.offPeak.observations} obs`} />
              </Row>

              {conn.data.lowSample ? (
                <View style={styles.warn}>
                  <Text style={styles.warnText}>⚠ Fewer than 30 observations — treat this as a preliminary estimate.</Text>
                </View>
              ) : null}

              <Muted>{conn.data.summaryText}</Muted>

              <View style={{ gap: theme.spacing(2) }}>
                <Text style={styles.subhead}>By day of week</Text>
                <Table
                  columns={[
                    { key: "day", label: "Day" },
                    { key: "rate", label: "Success", align: "right" },
                    { key: "obs", label: "Obs", align: "right" },
                  ]}
                  rows={conn.data.byDayOfWeek.map((d) => ({ day: DOW[d.dayOfWeek] ?? String(d.dayOfWeek), rate: `${d.successRatePercent}%`, obs: d.observations }))}
                />
              </View>

              <View style={{ gap: theme.spacing(2) }}>
                <Text style={styles.subhead}>Inbound delay at transfer</Text>
                <DelayHistogram distribution={conn.data.inboundDelayDistribution} />
              </View>
            </>
          ) : null}
        </Card>
      ) : (
        <Muted>Select a transfer above to see its reliability.</Muted>
      )}
    </Screen>
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
  warn: { backgroundColor: "#3b2f12", borderRadius: theme.radius, padding: theme.spacing(3) },
  warnText: { color: theme.colors.warn, fontSize: theme.fontSize.sm },
});
