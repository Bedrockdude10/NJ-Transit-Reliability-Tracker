import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NJ_STATE_OUTLINE, type MapLine, type MapStation } from "@njt/shared";
import { otpColor, theme } from "../../lib/theme";

export type MapColorMode = "reliability" | "line";

/**
 * Geographic schematic of the rail network, rendered with react-native-svg so
 * it works identically on web + native (no map tiles or API keys). Station
 * lat/lon are projected with a cosine-latitude correction and uniform scaling
 * to preserve the network's real shape; lines are colored by reliability or by
 * NJT's official line colors.
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

  // Fit the union of station coordinates and the NJ outline so the whole state
  // is visible with the network (which spills slightly past the border) on top.
  const lats = [...stations.map((s) => s.lat), ...NJ_STATE_OUTLINE.map(([, lat]) => lat)];
  const lons = [...stations.map((s) => s.lon), ...NJ_STATE_OUTLINE.map(([lon]) => lon)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180); // lon→x correction
  const pad = 14;
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const project = (lat: number, lon: number) => ({
    x: offX + (lon - minLon) * k * scale,
    y: offY + (maxLat - lat) * scale,
  });

  const coord = new Map(stations.map((s) => [s.stopId, project(s.lat, s.lon)]));
  const outlineD =
    NJ_STATE_OUTLINE.map(([lon, lat], i) => {
      const p = project(lat, lon);
      return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(" ") + " Z";
  const colorFor = (l: MapLine) =>
    colorMode === "line"
      ? `#${l.color}`
      : l.njtOtpPercent !== null
        ? otpColor(l.njtOtpPercent)
        : theme.colors.textMuted;
  const pathD = (l: MapLine) => {
    const pts = l.path.map((id) => coord.get(id)).filter((p): p is { x: number; y: number } => Boolean(p));
    if (pts.length < 2) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  return (
    <View onLayout={onLayout} style={{ width: "100%", height }}>
      {width > 0 && stations.length > 0 ? (
        <Svg width={width} height={height}>
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
            return c ? <Circle key={s.stopId} cx={c.x} cy={c.y} r={2.2} fill={theme.colors.text} opacity={0.65} /> : null;
          })}
        </Svg>
      ) : null}
    </View>
  );
}
