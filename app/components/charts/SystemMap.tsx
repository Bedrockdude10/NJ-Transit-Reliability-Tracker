import { useRouter } from "expo-router";
import { useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NJ_STATE_OUTLINE, type MapLine, type MapStation } from "@njt/shared";
import { formatPercent } from "../../lib/format";
import { otpColor, theme } from "../../lib/theme";

export type MapColorMode = "reliability" | "line";

interface Pt {
  x: number;
  y: number;
}

/** What the user tapped, plus the screen point to anchor the tooltip at. */
type Selection =
  | { kind: "station"; station: MapStation; at: Pt }
  | { kind: "line"; line: MapLine; at: Pt };

const TOOLTIP_WIDTH = 230;

/** Distance from point p to segment a–b (screen space). */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Geographic schematic of the rail network, rendered with react-native-svg so
 * it works identically on web + native (no map tiles or API keys). Station
 * lat/lon are projected with a cosine-latitude correction and uniform scaling
 * to preserve the network's real shape; lines are colored by reliability or by
 * NJT's official line colors. Tapping a station or line opens an in-place
 * tooltip with its details (deep-link is a secondary action inside the tip) —
 * resolved by a single coordinate hit-test, since react-native-web rejects
 * per-element handlers on raw SVG nodes.
 */
export function SystemMap({
  stations,
  lines,
  colorMode,
  height = 520,
}: {
  stations: MapStation[];
  lines: MapLine[];
  colorMode: MapColorMode;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const router = useRouter();

  const lats = [...stations.map((s) => s.lat), ...NJ_STATE_OUTLINE.map(([, lat]) => lat)];
  const lons = [...stations.map((s) => s.lon), ...NJ_STATE_OUTLINE.map(([lon]) => lon)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const pad = 14;
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const project = (lat: number, lon: number): Pt => ({ x: offX + (lon - minLon) * k * scale, y: offY + (maxLat - lat) * scale });

  const coord = new Map(stations.map((s) => [s.stopId, project(s.lat, s.lon)]));
  const outlineD = NJ_STATE_OUTLINE.map(([lon, lat], i) => {
    const p = project(lat, lon);
    return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(" ") + " Z";

  const colorFor = (l: MapLine) =>
    colorMode === "line" ? `#${l.color}` : l.njtOtpPercent !== null ? otpColor(l.njtOtpPercent) : theme.colors.textMuted;
  const linePoints = (l: MapLine) => l.path.map((id) => coord.get(id)).filter((p): p is Pt => Boolean(p));
  const pathD = (l: MapLine) => {
    const pts = linePoints(l);
    return pts.length < 2 ? "" : pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  /** Tap nearest station (within 14px), else nearest line (within 8px), else dismiss. */
  const handlePress = (e: GestureResponderEvent) => {
    // Native gives locationX/Y; react-native-web hands back the raw DOM event,
    // which carries offsetX/Y (relative to the element) instead.
    const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
    const p: Pt = { x: ne.locationX ?? ne.offsetX ?? 0, y: ne.locationY ?? ne.offsetY ?? 0 };
    let nearestStation: MapStation | null = null;
    let stationDist = Infinity;
    for (const s of stations) {
      const c = coord.get(s.stopId);
      if (!c) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < stationDist) [stationDist, nearestStation] = [d, s];
    }
    if (nearestStation && stationDist <= 14) {
      const c = coord.get(nearestStation.stopId) ?? p;
      setSelected({ kind: "station", station: nearestStation, at: c });
      return;
    }
    let nearestLine: MapLine | null = null;
    let lineDist = Infinity;
    for (const l of lines) {
      const pts = linePoints(l);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(p, pts[i] as Pt, pts[i + 1] as Pt);
        if (d < lineDist) [lineDist, nearestLine] = [d, l];
      }
    }
    if (nearestLine && lineDist <= 8) {
      setSelected({ kind: "line", line: nearestLine, at: p });
      return;
    }
    setSelected(null); // tapped empty space → dismiss any open tooltip
  };

  const selectedStationId = selected?.kind === "station" ? selected.station.stopId : null;
  const selectedLineId = selected?.kind === "line" ? selected.line.lineId : null;
  const selectedLinePath = selected?.kind === "line" ? pathD(selected.line) : "";

  return (
    <View testID="system-map" onLayout={onLayout} style={{ width: "100%", height }}>
      <Pressable onPress={handlePress} style={StyleSheet.absoluteFill}>
        {width > 0 && stations.length > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            <Path d={outlineD} fill={theme.colors.surfaceAlt} stroke={theme.colors.border} strokeWidth={1} opacity={0.55} />
            {lines.map((l) => {
              const d = pathD(l);
              if (!d) return null;
              const lightRail = l.mode === "light_rail";
              const dimmed = selectedLineId !== null && l.lineId !== selectedLineId;
              return (
                <Path
                  key={l.lineId}
                  d={d}
                  stroke={colorFor(l)}
                  strokeWidth={lightRail ? 2 : 3}
                  strokeDasharray={lightRail ? "5,4" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                  opacity={dimmed ? 0.3 : 0.9}
                />
              );
            })}
            {/* Highlight the selected line on top, thicker and at full opacity. */}
            {selectedLinePath && selected?.kind === "line" ? (
              <Path
                d={selectedLinePath}
                stroke={colorFor(selected.line)}
                strokeWidth={selected.line.mode === "light_rail" ? 4 : 5}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                opacity={1}
              />
            ) : null}
            {stations.map((s) => {
              const c = coord.get(s.stopId);
              if (!c) return null;
              const active = s.stopId === selectedStationId;
              return (
                <Circle
                  key={s.stopId}
                  cx={c.x}
                  cy={c.y}
                  r={active ? 5 : 2.6}
                  fill={active ? theme.colors.accent : theme.colors.text}
                  stroke={active ? theme.colors.background : undefined}
                  strokeWidth={active ? 1.5 : 0}
                  opacity={active ? 1 : 0.7}
                />
              );
            })}
          </Svg>
        ) : null}
      </Pressable>
      {selected ? (
        <MapTooltip
          selection={selected}
          lines={lines}
          width={width}
          height={height}
          onClose={() => setSelected(null)}
          onOpenStation={(stopId) => router.push(`/stations/${stopId}`)}
          onOpenLine={(l) => router.push(l.mode === "light_rail" ? "/lightrail" : `/lines/${l.lineId}`)}
        />
      ) : null}
    </View>
  );
}

/** Absolutely-positioned info card anchored near the tapped point, clamped on-screen. */
function MapTooltip({
  selection,
  lines,
  width,
  height,
  onClose,
  onOpenStation,
  onOpenLine,
}: {
  selection: Selection;
  lines: MapLine[];
  width: number;
  height: number;
  onClose: () => void;
  onOpenStation: (stopId: string) => void;
  onOpenLine: (line: MapLine) => void;
}) {
  const { at } = selection;
  const left = Math.max(4, Math.min(at.x - TOOLTIP_WIDTH / 2, width - TOOLTIP_WIDTH - 4));
  const placeAbove = at.y > height - 150;
  const top = placeAbove ? Math.max(4, at.y - 158) : at.y + 16;

  return (
    <View style={[styles.tip, { left, top }]}>
      <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
        <Text style={styles.closeText}>×</Text>
      </Pressable>

      {selection.kind === "station" ? (
        <StationTip
          station={selection.station}
          servingLines={lines.filter((l) => l.path.includes(selection.station.stopId))}
          onOpen={() => onOpenStation(selection.station.stopId)}
        />
      ) : (
        <LineTip line={selection.line} onOpen={() => onOpenLine(selection.line)} />
      )}
    </View>
  );
}

function StationTip({ station, servingLines, onOpen }: { station: MapStation; servingLines: MapLine[]; onOpen: () => void }) {
  const shown = servingLines.slice(0, 5);
  const extra = servingLines.length - shown.length;
  return (
    <>
      <Text style={styles.tipTitle} numberOfLines={2}>
        {station.stopName}
      </Text>
      <Text style={styles.tipSub}>
        {servingLines.length > 0 ? `${servingLines.length} line${servingLines.length === 1 ? "" : "s"}` : "No lines mapped"}
      </Text>
      {shown.length > 0 ? (
        <View style={styles.chipRow}>
          {shown.map((l) => (
            <View key={l.lineId} style={styles.chip}>
              <View style={[styles.chipDot, { backgroundColor: `#${l.color}` }]} />
              <Text style={styles.chipText}>{l.shortName}</Text>
            </View>
          ))}
          {extra > 0 ? <Text style={styles.tipSub}>+{extra}</Text> : null}
        </View>
      ) : null}
      <Pressable onPress={onOpen}>
        <Text style={styles.tipLink}>Open station →</Text>
      </Pressable>
    </>
  );
}

function LineTip({ line, onOpen }: { line: MapLine; onOpen: () => void }) {
  return (
    <>
      <View style={styles.tipHeadRow}>
        <View style={[styles.chipDot, { backgroundColor: `#${line.color}` }]} />
        <Text style={styles.tipTitle} numberOfLines={2}>
          {line.name}
        </Text>
      </View>
      <Text style={styles.tipSub}>{line.mode === "light_rail" ? "Light rail" : "Commuter rail"}</Text>
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>NJT OTP (6 min)</Text>
        <Text style={[styles.statVal, { color: line.njtOtpPercent !== null ? otpColor(line.njtOtpPercent) : theme.colors.textMuted }]}>
          {formatPercent(line.njtOtpPercent)}
        </Text>
      </View>
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Independent ≤15 min</Text>
        <Text style={styles.statVal}>{formatPercent(line.projectOtpPercent15Min)}</Text>
      </View>
      <Pressable onPress={onOpen}>
        <Text style={styles.tipLink}>{line.mode === "light_rail" ? "Open light rail →" : "Open line detail →"}</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  tip: {
    position: "absolute",
    width: TOOLTIP_WIDTH,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
    // Float above the SVG.
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  close: { position: "absolute", top: 2, right: 6, padding: theme.spacing(1) },
  closeText: { color: theme.colors.textMuted, fontSize: theme.fontSize.lg, fontWeight: "700", lineHeight: 20 },
  tipHeadRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingRight: theme.spacing(4) },
  tipTitle: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "800", flexShrink: 1, paddingRight: theme.spacing(4) },
  tipSub: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing(1) },
  chip: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1), backgroundColor: theme.colors.surfaceAlt, borderRadius: 999, paddingHorizontal: theme.spacing(2), paddingVertical: 2 },
  chipDot: { width: 9, height: 9, borderRadius: 5 },
  chipText: { color: theme.colors.text, fontSize: theme.fontSize.xs, fontWeight: "600" },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: theme.spacing(2) },
  statLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  statVal: { color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: "800" },
  tipLink: { color: theme.colors.accent, fontSize: theme.fontSize.sm, fontWeight: "700", marginTop: theme.spacing(1) },
});
