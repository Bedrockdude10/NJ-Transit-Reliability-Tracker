import { useRouter } from "expo-router";
import { useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NJ_STATE_OUTLINE, type MapLine, type MapStation } from "@njt/shared";
import { otpColor, theme } from "../../lib/theme";

export type MapColorMode = "reliability" | "line";

interface Pt {
  x: number;
  y: number;
}

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
 * NJT's official line colors. Tapping a station or line deep-links to its
 * detail — handled by a single coordinate hit-test (rather than per-element
 * handlers, which react-native-web rejects on raw SVG nodes).
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

  const openLine = (l: MapLine) => router.push(l.mode === "light_rail" ? "/lightrail" : `/lines/${l.lineId}`);

  /** Tap nearest station (within 14px), else nearest line (within 8px). */
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
      router.push(`/stations/${nearestStation.stopId}`);
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
    if (nearestLine && lineDist <= 8) openLine(nearestLine);
  };

  return (
    <Pressable testID="system-map" onLayout={onLayout} onPress={handlePress} style={{ width: "100%", height }}>
      {width > 0 && stations.length > 0 ? (
        <Svg width={width} height={height} pointerEvents="none">
          <Path d={outlineD} fill={theme.colors.surfaceAlt} stroke={theme.colors.border} strokeWidth={1} opacity={0.55} />
          {lines.map((l) => {
            const d = pathD(l);
            if (!d) return null;
            const lightRail = l.mode === "light_rail";
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
                opacity={0.9}
              />
            );
          })}
          {stations.map((s) => {
            const c = coord.get(s.stopId);
            return c ? <Circle key={s.stopId} cx={c.x} cy={c.y} r={2.6} fill={theme.colors.text} opacity={0.7} /> : null;
          })}
        </Svg>
      ) : null}
    </Pressable>
  );
}
