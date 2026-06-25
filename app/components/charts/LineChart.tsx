import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { linePath, linePoints } from "../../lib/charts";
import { theme } from "../../lib/theme";

export interface LineSeries {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/**
 * Multi-series line chart on a fixed 0-100 axis (used for OTP trends). Renders
 * a baseline + each series, with a legend below.
 */
export function LineChart({ series, height = 180 }: { series: LineSeries[]; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const plotHeight = height;

  return (
    <View style={styles.wrap}>
      <View onLayout={onLayout} style={{ width: "100%", height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[0, 25, 50, 75, 100].map((pct) => {
              const y = plotHeight - (pct / 100) * plotHeight;
              return <Line key={pct} x1={0} y1={y} x2={width} y2={y} stroke={theme.colors.border} strokeWidth={1} />;
            })}
            {series.map((s) => (
              <Path
                key={s.label}
                d={linePath(linePoints(s.values, { width, height: plotHeight, minValue: 0, maxValue: 100 }))}
                stroke={s.color}
                strokeWidth={2}
                fill="none"
                strokeDasharray={s.dashed ? "5,4" : undefined}
              />
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
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
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
});
