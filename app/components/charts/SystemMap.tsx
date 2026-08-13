import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { NJ_STATE_OUTLINE, type MapLine, type MapStation, type MapVehicle } from "@njt/shared";
import { formatPercent } from "../../lib/format";
import { applyZoom, buildProjection, clampView, distToSegment, type Pt, type ViewBox } from "../../lib/map-projection";
import { otpColor, otpColorAt, theme } from "../../lib/theme";
import { useChartColors } from "../../lib/useChartColors";

export type MapColorMode = "reliability" | "line";

/** What the user tapped, plus the screen point to anchor the tooltip at. */
type Selection =
  | { kind: "station"; station: MapStation; at: Pt }
  | { kind: "line"; line: MapLine; at: Pt };

const TOOLTIP_WIDTH = 230;

/**
 * Colour a live train by how it is running, not by its line: on a map whose
 * lines are already coloured, a train's own colour is only worth spending on
 * the thing you cannot otherwise see.
 */
function vehicleColor(v: MapVehicle, c: ReturnType<typeof useChartColors>): string {
  if (v.status === "stopped_at") return c.accent;
  return c.text;
}

/**
 * Geographic schematic of the rail network (react-native-svg, web + native).
 * Station lat/lon are projected with a cosine-latitude correction over the NJ
 * outline. Pan + zoom (mouse wheel / drag on web, plus on-screen controls) are
 * applied as an SVG group transform; tapping hit-tests in base coordinates
 * (inverting the transform) and opens an in-place tooltip with deep-link.
 * Live train positions are overlaid on top when supplied.
 */
export function SystemMap({
  stations,
  lines,
  colorMode,
  vehicles = [],
  height = 520,
}: {
  stations: MapStation[];
  lines: MapLine[];
  colorMode: MapColorMode;
  /** Live positions to overlay. Already filtered for staleness by the caller. */
  vehicles?: MapVehicle[];
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [view, setView] = useState<ViewBox>({ scale: 1, tx: 0, ty: 0 });
  const containerRef = useRef<View>(null);
  const router = useRouter();
  const c = useChartColors();

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // --- projection (base, unzoomed coordinates) -----------------------------
  // Pure and depends only on the stations + viewport size, so it's memoized
  // rather than rebuilt on every pan/zoom frame.
  const { coord, outlineD, project } = useMemo(
    () => buildProjection(stations, NJ_STATE_OUTLINE, width, height),
    [stations, width, height],
  );

  const colorFor = (l: MapLine) =>
    colorMode === "line" ? `#${l.color}` : l.njtOtpPercent !== null ? otpColorAt(c, l.njtOtpPercent) : c.textMuted;
  const linePoints = (l: MapLine) => l.path.map((id) => coord.get(id)).filter((p): p is Pt => Boolean(p));
  const pathD = (l: MapLine) => {
    const pts = linePoints(l);
    return pts.length < 2 ? "" : pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  // --- hit testing (screen point → base coords) ----------------------------
  // Refs keep the latest state available to the once-attached DOM listeners.
  const itx = useRef<{ view: ViewBox; coord: Map<string, Pt>; stations: MapStation[]; lines: MapLine[]; lp: (l: MapLine) => Pt[] }>({
    view,
    coord,
    stations,
    lines,
    lp: linePoints,
  });
  itx.current = { view, coord, stations, lines, lp: linePoints };

  const tapAt = (p: Pt) => {
    const { view: v, coord: cd, stations: sts, lines: lns, lp } = itx.current;
    const base: Pt = { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
    let nearestStation: MapStation | null = null;
    let stationDist = Infinity;
    for (const s of sts) {
      const c = cd.get(s.stopId);
      if (!c) continue;
      const d = Math.hypot(base.x - c.x, base.y - c.y);
      if (d < stationDist) [stationDist, nearestStation] = [d, s];
    }
    if (nearestStation && stationDist <= 14 / v.scale) {
      const c = cd.get(nearestStation.stopId)!;
      setSelected({ kind: "station", station: nearestStation, at: { x: c.x * v.scale + v.tx, y: c.y * v.scale + v.ty } });
      return;
    }
    let nearestLine: MapLine | null = null;
    let lineDist = Infinity;
    for (const l of lns) {
      const pts = lp(l);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(base, pts[i] as Pt, pts[i + 1] as Pt);
        if (d < lineDist) [lineDist, nearestLine] = [d, l];
      }
    }
    if (nearestLine && lineDist <= 8 / v.scale) {
      setSelected({ kind: "line", line: nearestLine, at: { x: p.x, y: p.y } });
      return;
    }
    setSelected(null);
  };

  // --- web pan/zoom via native DOM events ----------------------------------
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el) return;
    el.style.touchAction = "none";
    const rel = (e: PointerEvent | WheelEvent): Pt => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let down: { p: Pt; tx: number; ty: number } | null = null;
    let dragged = false;

    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return; // ignore clicks on controls/tooltip (the SVG is pointer-events:none)
      down = { p: rel(e), tx: itx.current.view.tx, ty: itx.current.view.ty };
      dragged = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const p = rel(e);
      const dx = p.x - down.p.x;
      const dy = p.y - down.p.y;
      if (!dragged && Math.hypot(dx, dy) > 4) {
        dragged = true;
        setSelected(null);
      }
      if (dragged && itx.current.view.scale > 1) {
        const w = el.clientWidth;
        setView((v) => clampView({ scale: v.scale, tx: down!.tx + dx, ty: down!.ty + dy }, w, height));
      }
    };
    const onUp = (e: PointerEvent) => {
      if (down && !dragged) tapAt(rel(e));
      down = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSelected(null);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => applyZoom(v, rel(e), factor, el.clientWidth, height));
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const zoomButton = (factor: number) => () => {
    setSelected(null);
    setView((v) => applyZoom(v, { x: width / 2, y: height / 2 }, factor, width, height));
  };
  const resetView = () => {
    setSelected(null);
    setView({ scale: 1, tx: 0, ty: 0 });
  };

  const selectedStationId = selected?.kind === "station" ? selected.station.stopId : null;
  const selectedLineId = selected?.kind === "line" ? selected.line.lineId : null;
  const transform = `translate(${view.tx} ${view.ty}) scale(${view.scale})`;

  return (
    <View ref={containerRef} testID="system-map" onLayout={onLayout} style={[styles.container, { height }]}>
      {width > 0 && stations.length > 0 ? (
        <Svg width={width} height={height} pointerEvents="none">
          <G transform={transform}>
            <Path d={outlineD} fill={c.surfaceAlt} stroke={c.border} strokeWidth={1} opacity={0.55} />
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
                  strokeWidth={(lightRail ? 2 : 3) / Math.sqrt(view.scale)}
                  strokeDasharray={lightRail ? "5,4" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                  opacity={dimmed ? 0.3 : 0.9}
                />
              );
            })}
            {selected?.kind === "line" ? (
              <Path d={pathD(selected.line)} stroke={colorFor(selected.line)} strokeWidth={(selected.line.mode === "light_rail" ? 4 : 5) / Math.sqrt(view.scale)} strokeLinejoin="round" strokeLinecap="round" fill="none" opacity={1} />
            ) : null}
            {stations.map((s) => {
              const pt = coord.get(s.stopId);
              if (!pt) return null;
              const active = s.stopId === selectedStationId;
              const r = (active ? 5 : 2.6) / Math.sqrt(view.scale);
              return <Circle key={s.stopId} cx={pt.x} cy={pt.y} r={r} fill={active ? c.accent : c.text} stroke={active ? c.background : undefined} strokeWidth={active ? 1.5 / view.scale : 0} opacity={active ? 1 : 0.7} />;
            })}
            {/* Live trains, drawn last so they sit above the network. Each is a
                chevron pointing along its reported bearing; a train with no
                bearing gets a plain dot rather than an invented heading. */}
            {vehicles.map((v) => {
              const pt = project(v.latitude, v.longitude);
              const size = 5 / Math.sqrt(view.scale);
              const fill = vehicleColor(v, c);
              if (v.bearing === null) {
                return (
                  <Circle key={v.vehicleId} cx={pt.x} cy={pt.y} r={size * 0.7} fill={fill} stroke={c.background} strokeWidth={1 / view.scale} />
                );
              }
              return (
                <Path
                  key={v.vehicleId}
                  d={`M0,${-size * 1.4} L${size},${size} L0,${size * 0.45} L${-size},${size} Z`}
                  transform={`translate(${pt.x} ${pt.y}) rotate(${v.bearing})`}
                  fill={fill}
                  stroke={c.background}
                  strokeWidth={1 / view.scale}
                />
              );
            })}
          </G>
        </Svg>
      ) : null}

      {/* Native tap layer (web uses DOM pointer events on the container). */}
      {Platform.OS !== "web" ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => tapAt({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })}
        />
      ) : null}

      {/* Zoom controls */}
      <View style={styles.controls}>
        <Pressable style={styles.ctrlBtn} onPress={zoomButton(1.6)} accessibilityLabel="Zoom in"><Text style={styles.ctrlText}>+</Text></Pressable>
        <Pressable style={styles.ctrlBtn} onPress={zoomButton(1 / 1.6)} accessibilityLabel="Zoom out"><Text style={styles.ctrlText}>−</Text></Pressable>
        {view.scale > 1 ? <Pressable style={styles.ctrlBtn} onPress={resetView} accessibilityLabel="Reset view"><Text style={styles.ctrlReset}>⤢</Text></Pressable> : null}
      </View>

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
      {selection.kind === "station" ? (
        <StationTip
          station={selection.station}
          servingLines={lines.filter((l) => l.path.includes(selection.station.stopId))}
          onOpen={() => onOpenStation(selection.station.stopId)}
        />
      ) : (
        <LineTip line={selection.line} onOpen={() => onOpenLine(selection.line)} />
      )}
      {/* Rendered last so it paints above the content and stays clickable. */}
      <Pressable onPress={onClose} style={styles.close} hitSlop={10} accessibilityLabel="Close">
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
}

function StationTip({ station, servingLines, onOpen }: { station: MapStation; servingLines: MapLine[]; onOpen: () => void }) {
  const shown = servingLines.slice(0, 5);
  const extra = servingLines.length - shown.length;
  return (
    <>
      <Text style={styles.tipTitle} numberOfLines={2}>{station.stopName}</Text>
      <Text style={styles.tipSub}>{servingLines.length > 0 ? `${servingLines.length} line${servingLines.length === 1 ? "" : "s"}` : "No lines mapped"}</Text>
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
      <Pressable onPress={onOpen}><Text style={styles.tipLink}>Open station →</Text></Pressable>
    </>
  );
}

function LineTip({ line, onOpen }: { line: MapLine; onOpen: () => void }) {
  return (
    <>
      <View style={styles.tipHeadRow}>
        <View style={[styles.chipDot, { backgroundColor: `#${line.color}` }]} />
        <Text style={styles.tipTitle} numberOfLines={2}>{line.name}</Text>
      </View>
      <Text style={styles.tipSub}>{line.mode === "light_rail" ? "Light rail" : "Commuter rail"}</Text>
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>NJT OTP (6 min)</Text>
        <Text style={[styles.statVal, { color: line.njtOtpPercent !== null ? otpColor(line.njtOtpPercent) : theme.colors.textMuted }]}>{formatPercent(line.njtOtpPercent)}</Text>
      </View>
      <View style={styles.statRow}>
        <Text style={styles.statLabel}>Independent ≤15 min</Text>
        <Text style={styles.statVal}>{formatPercent(line.projectOtpPercent15Min)}</Text>
      </View>
      <Pressable onPress={onOpen}><Text style={styles.tipLink}>{line.mode === "light_rail" ? "Open light rail →" : "Open line detail →"}</Text></Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", position: "relative", overflow: "hidden", borderRadius: theme.radii.md },
  controls: { position: "absolute", top: theme.spacing(2), right: theme.spacing(2), gap: theme.spacing(2) },
  ctrlBtn: {
    width: 34,
    height: 34,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  ctrlText: { color: theme.colors.text, fontSize: 20, fontWeight: "700", lineHeight: 22 },
  ctrlReset: { color: theme.colors.textMuted, fontSize: 16, fontWeight: "700" },
  tip: {
    position: "absolute",
    width: TOOLTIP_WIDTH,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    gap: theme.spacing(2),
    ...theme.shadow.pop,
  },
  close: { position: "absolute", top: 2, right: 6, padding: theme.spacing(1), zIndex: 5 },
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
