import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { formatPercent } from "../../lib/format";
import { otpColor, theme } from "../../lib/theme";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { SystemMap, type MapColorMode } from "../../components/charts/SystemMap";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, Screen } from "../../components/ui";

export default function MapScreen() {
  const [windowKey, setWindowKey] = useState<WindowKey>("90d");
  const [days, setDays] = useState(90);
  const [mode, setMode] = useState<MapColorMode>("reliability");
  const range = useMemo(() => windowToRange(days), [days]);
  const map = useApi(() => api.map(range), [range.from, range.to]);

  const lines = [...(map.data?.lines ?? [])].sort((a, b) => {
    if (a.njtOtpPercent === null) return 1;
    if (b.njtOtpPercent === null) return -1;
    return a.njtOtpPercent - b.njtOtpPercent;
  });

  return (
    <Screen>
      <PageTitle title="System Map" subtitle="NJ Transit rail network from the real GTFS feed" />
      <Row>
        <WindowPicker value={windowKey} onChange={(k, d) => { setWindowKey(k); setDays(d); }} />
        <View style={styles.toggle}>
          {(["reliability", "line"] as MapColorMode[]).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggleBtn, mode === m && styles.toggleActive]}>
              <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{m === "reliability" ? "Reliability" : "Line colors"}</Text>
            </Pressable>
          ))}
        </View>
      </Row>

      {map.loading ? <Loading /> : null}
      {map.error ? <ErrorView message={map.error} onRetry={map.reload} /> : null}
      {map.data ? (
        <>
          <Card>
            <SystemMap stations={map.data.stations} lines={map.data.lines} colorMode={mode} />
            <Muted>
              {map.data.stations.length} stations · {map.data.lines.length} lines · positions from NJT's GTFS feed.{" "}
              {mode === "reliability" ? "Line color is NJT's reported OTP — greener is more reliable." : "Official NJT line colors."}
            </Muted>
          </Card>

          <Card>
            <SectionTitle>Lines — tap for detail</SectionTitle>
            {lines.map((l) => (
              <Link key={l.lineId} href={`/lines/${l.lineId}`} asChild>
                <Pressable style={styles.legendRow}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: mode === "line" ? `#${l.color}` : l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted },
                    ]}
                  />
                  <Text style={styles.legendName}>{l.name}</Text>
                  <Text style={[styles.legendOtp, { color: l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted }]}>
                    {formatPercent(l.njtOtpPercent)}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius, padding: 2 },
  toggleBtn: { paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1), borderRadius: theme.radius - 2 },
  toggleActive: { backgroundColor: theme.colors.accent },
  toggleText: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, fontWeight: "600" },
  toggleTextActive: { color: theme.colors.background },
  legendRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  legendName: { color: theme.colors.text, flex: 1, fontWeight: "600" },
  legendOtp: { fontWeight: "800" },
});
