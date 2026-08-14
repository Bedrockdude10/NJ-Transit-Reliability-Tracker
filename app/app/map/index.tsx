import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type DateRange } from "../../lib/api";
import { formatPercent } from "../../lib/format";
import { otpColor, theme } from "../../lib/theme";
import { useWindow } from "../../hooks/useWindow";
import { useApi } from "../../hooks/useApi";
import { useLiveApi } from "../../hooks/useLiveApi";
import { useNow } from "../../hooks/useNow";
import { splitLiveVehicles, staleVehicleNote } from "../../lib/vehicles";
import { SystemMap, type MapColorMode } from "../../components/charts/SystemMap";
import { WindowPicker } from "../../components/WindowPicker";
import { QueryBoundary } from "../../components/QueryBoundary";
import { Card, Muted, PageTitle, Row, SectionTitle, StatusDot, Screen } from "../../components/ui";

/** VehiclePositions is polled every 60s upstream; matching it is enough. */
const VEHICLES_REFRESH_MS = 20_000;

export default function MapScreen() {
  const { key: windowKey, range, select: selectWindow } = useWindow("90d");
  const [mode, setMode] = useState<MapColorMode>("reliability");
  const [showLive, setShowLive] = useState(true);

  return (
    <Screen>
      <PageTitle title="System Map" subtitle="NJ Transit rail network from the real GTFS feed" />
      <Row>
        <WindowPicker value={windowKey} onChange={selectWindow} />
        <View style={styles.toggle}>
          {(["reliability", "line"] as MapColorMode[]).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggleBtn, mode === m && styles.toggleActive]}>
              <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{m === "reliability" ? "Reliability" : "Line colors"}</Text>
            </Pressable>
          ))}
        </View>
      </Row>

      <QueryBoundary>
        <NetworkMap range={range} mode={mode} showLive={showLive} onToggleLive={() => setShowLive((v) => !v)} />
      </QueryBoundary>

      <QueryBoundary>
        <LineLegend range={range} mode={mode} />
      </QueryBoundary>
    </Screen>
  );
}

function NetworkMap({
  range,
  mode,
  showLive,
  onToggleLive,
}: {
  range: Required<DateRange>;
  mode: MapColorMode;
  showLive: boolean;
  onToggleLive: () => void;
}) {
  const { data: map } = useApi(api.map(range));
  const vehicles = useLiveApi(api.mapVehicles(), VEHICLES_REFRESH_MS);
  const now = useNow(5_000);

  // The feed leaves departed trains in place, so anything stale is withheld
  // rather than drawn as if it were where the train is now.
  const { live, hiddenStale } = useMemo(() => splitLiveVehicles(vehicles.data.vehicles), [vehicles.data]);
  const shown = showLive ? live : [];

  return (
    <Card
      title="Network"
      right={
        <Row wrap={false}>
          <Pressable onPress={onToggleLive} style={[styles.liveToggle, showLive && styles.liveToggleOn]}>
            <StatusDot color={showLive ? theme.colors.good : theme.colors.textFaint} pulse={showLive} />
            <Text style={[styles.liveToggleText, showLive && styles.liveToggleTextOn]}>
              {showLive ? `${shown.length} live` : "Live off"}
            </Text>
          </Pressable>
        </Row>
      }
    >
      <SystemMap stations={map.stations} lines={map.lines} colorMode={mode} vehicles={shown} />
      <Muted>
        {map.stations.length} stations · {map.lines.length} lines · positions from NJT's GTFS feed. Tap a station or
        line for details; tap empty space to dismiss.{" "}
        {mode === "reliability" ? "Line color is NJT's reported OTP — greener is more reliable." : "Official NJT line colors."}
      </Muted>
      {showLive ? (
        <View style={styles.liveNote}>
          <Muted>
            Arrows are trains now, pointing the way they are heading; a filled dot marks one stopped at a station.
            {vehicles.updatedAtMs ? ` Updated ${Math.max(0, Math.round((now - vehicles.updatedAtMs) / 1000))}s ago.` : ""}
          </Muted>
          {staleVehicleNote(hiddenStale) ? <Muted>{staleVehicleNote(hiddenStale)}</Muted> : null}
          {shown.length === 0 ? (
            <Muted>No trains are reporting a current position — likely outside service hours.</Muted>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function LineLegend({ range, mode }: { range: Required<DateRange>; mode: MapColorMode }) {
  const { data: map } = useApi(api.map(range));

  const byOtp = (a: { njtOtpPercent: number | null }, b: { njtOtpPercent: number | null }) => {
    if (a.njtOtpPercent === null) return 1;
    if (b.njtOtpPercent === null) return -1;
    return a.njtOtpPercent - b.njtOtpPercent;
  };
  const railLines = map.lines.filter((l) => l.mode === "rail").sort(byOtp);
  const lightRailLines = map.lines.filter((l) => l.mode === "light_rail");
  const swatchColor = (l: (typeof map.lines)[number]) =>
    mode === "line" ? `#${l.color}` : l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted;

  return (
    <>
      <Card>
        <SectionTitle>Rail lines — tap for detail</SectionTitle>
        {railLines.map((l) => (
          <Link key={l.lineId} href={`/lines/${l.lineId}`} asChild>
            <Pressable style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: swatchColor(l) }]} />
              <Text style={styles.legendName}>{l.name}</Text>
              <Text style={[styles.legendOtp, { color: l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted }]}>
                {formatPercent(l.njtOtpPercent)}
              </Text>
            </Pressable>
          </Link>
        ))}
      </Card>

      {lightRailLines.length > 0 ? (
        <Card>
          <SectionTitle>Light rail (dashed)</SectionTitle>
          {lightRailLines.map((l) => (
            <Link key={l.lineId} href="/lightrail" asChild>
              <Pressable style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: swatchColor(l) }]} />
                <Text style={styles.legendName}>{l.name}</Text>
                <Text style={[styles.legendOtp, { color: l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted }]}>
                  {formatPercent(l.njtOtpPercent)}
                </Text>
              </Pressable>
            </Link>
          ))}
        </Card>
      ) : null}
    </>
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
  liveToggle: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(1), borderRadius: theme.radii.pill, backgroundColor: theme.colors.surfaceAlt },
  liveToggleOn: { backgroundColor: theme.colors.goodSoft },
  liveToggleText: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "700" },
  liveToggleTextOn: { color: theme.colors.good },
  liveNote: { gap: theme.spacing(1), marginTop: theme.spacing(1) },
});
