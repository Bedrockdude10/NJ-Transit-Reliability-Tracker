import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { gaugeArc } from "../../lib/charts";
import { theme } from "../../lib/theme";
import { useChartColors } from "../../lib/useChartColors";

const START = 135; // bottom-left
const SWEEP = 270; // leaves a 90° gap at the bottom

/** Radial gauge for a 0–100 value. */
export function Gauge({
  value,
  size = 168,
  color,
  label,
  caption,
}: {
  value: number;
  size?: number;
  color?: string;
  label: string;
  caption?: string;
}) {
  const c = useChartColors();
  const arcColor = color ?? c.accent;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const frac = Math.max(0, Math.min(1, value / 100));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Path d={gaugeArc(cx, cy, r, START, START + SWEEP)} stroke={c.track} strokeWidth={stroke} fill="none" strokeLinecap="round" />
        {frac > 0 ? (
          <Path d={gaugeArc(cx, cy, r, START, START + SWEEP * frac)} stroke={arcColor} strokeWidth={stroke} fill="none" strokeLinecap="round" />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.value, { color: arcColor }]}>{label}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: 2 },
  value: { fontSize: 38, fontWeight: "800", letterSpacing: -1 },
  caption: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600" },
});
