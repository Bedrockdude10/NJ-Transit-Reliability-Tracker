import { useId, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from "react-native-svg";
import { areaPath, axisTicks, linePoints, smoothPath } from "../../lib/charts";
import { theme } from "../../lib/theme";
import { useChartColors } from "../../lib/useChartColors";

export interface LineSeries {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

const Y_AXIS_W = 30;
const PAD_TOP = 10;
const PAD_BOTTOM = 8;

/**
 * Multi-series line chart on a fixed axis (0–100 by default, for OTP). Renders
 * gridlines with y-axis labels, a smooth curve per series, a soft gradient area
 * under the primary series, and a labeled dot at each series' last value. The
 * legend sits below.
 */
export function LineChart({
  series,
  height = 200,
  maxValue = 100,
  unit = "%",
  area,
}: {
  series: LineSeries[];
  height?: number;
  maxValue?: number;
  unit?: string;
  area?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const c = useChartColors();
  const gradId = useId();
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotW = Math.max(1, width - Y_AXIS_W);
  const plotH = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
  const ticks = axisTicks(maxValue, 4);
  const showArea = area ?? series.length === 1;

  const project = (values: number[]) =>
    linePoints(values, { width: plotW, height: plotH, minValue: 0, maxValue }).map((p) => ({ x: p.x + Y_AXIS_W, y: p.y + PAD_TOP }));

  return (
    <View style={styles.wrap}>
      <View onLayout={onLayout} style={{ width: "100%", height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={`area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={series[0]?.color ?? c.accent} stopOpacity={0.28} />
                <Stop offset="1" stopColor={series[0]?.color ?? c.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* gridlines + y labels */}
            {ticks.map((t, i) => {
              const y = PAD_TOP + plotH * (1 - t / maxValue);
              return (
                <Line key={`g${i}`} x1={Y_AXIS_W} y1={y} x2={width} y2={y} stroke={c.gridLine} strokeWidth={1} />
              );
            })}
            {ticks.map((t, i) => {
              const y = PAD_TOP + plotH * (1 - t / maxValue);
              return (
                <SvgText key={`l${i}`} x={Y_AXIS_W - 6} y={y + 3} fill={c.textFaint} fontSize={9} textAnchor="end">
                  {t}
                  {unit}
                </SvgText>
              );
            })}

            {showArea && series[0] && series[0].values.length > 1 ? (
              <Path d={areaPath(project(series[0].values), PAD_TOP + plotH)} fill={`url(#area-${gradId})`} />
            ) : null}

            {series.map((s) => {
              if (s.values.length === 0) return null;
              return (
                <Path key={s.label} d={smoothPath(project(s.values))} stroke={s.color} strokeWidth={2.5} fill="none" strokeDasharray={s.dashed ? "5,4" : undefined} strokeLinecap="round" strokeLinejoin="round" />
              );
            })}

            {/* endpoint dots */}
            {series.map((s) => {
              if (s.values.length === 0) return null;
              const pts = project(s.values);
              const last = pts[pts.length - 1]!;
              return <Circle key={`d${s.label}`} cx={last.x} cy={last.y} r={3.5} fill={s.color} stroke={c.surface} strokeWidth={2} />;
            })}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }, s.dashed ? styles.swatchDashed : null]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
            {s.values.length > 0 ? <Text style={[styles.legendValue, { color: s.color }]}>{s.values[s.values.length - 1]}{unit}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing(2) },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(3) },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1) },
  swatch: { width: 14, height: 4, borderRadius: 2 },
  swatchDashed: { opacity: 0.7 },
  legendLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  legendValue: { fontSize: theme.fontSize.xs, fontWeight: "700" },
});
