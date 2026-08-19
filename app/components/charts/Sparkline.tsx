import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useId } from "react";
import { areaPath, linePoints, smoothPath } from "../../lib/charts";
import { useChartColors } from "../../lib/useChartColors";

/** Scales to its own min/max, so the shape shows regardless of absolute range. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const c = useChartColors();
  const stroke = color ?? c.accent;
  const gradId = useId();
  if (values.length < 2) return <Svg width={width} height={height} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 2;
  const pts = linePoints(values, { width: width - pad * 2, height: height - pad * 2, minValue: min, maxValue: max === min ? min + 1 : max }).map((p) => ({
    x: p.x + pad,
    y: p.y + pad,
  }));
  const last = pts[pts.length - 1];
  if (last === undefined) return <Svg width={width} height={height} />;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.3} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill ? <Path d={areaPath(pts, height)} fill={`url(#spark-${gradId})`} /> : null}
      <Path d={smoothPath(pts)} stroke={stroke} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
    </Svg>
  );
}
