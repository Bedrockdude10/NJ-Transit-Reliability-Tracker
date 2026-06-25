import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { barLayout, niceMax } from "../../lib/charts";
import { theme } from "../../lib/theme";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface ReferenceLine {
  value: number;
  label: string;
  color: string;
}

/**
 * Vertical bar chart rendered with react-native-svg (works on web + native).
 * Width is measured from the container so it fills the card responsively. An
 * optional `referenceLine` draws a horizontal marker (e.g. NJT's reported OTP)
 * across the chart, scaled on the same axis as the bars.
 */
export function BarChart({
  data,
  height = 180,
  showValues = true,
  maxValue,
  referenceLine,
  formatValue = (v) => String(v),
}: {
  data: readonly BarDatum[];
  height?: number;
  showValues?: boolean;
  maxValue?: number;
  referenceLine?: ReferenceLine;
  formatValue?: (value: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const labelSpace = 20;
  const valueSpace = showValues ? 16 : 0;
  const chartHeight = Math.max(1, height - labelSpace - valueSpace);
  const max = maxValue ?? niceMax(Math.max(0, ...data.map((d) => d.value)));
  const bars = barLayout(
    data.map((d) => d.value),
    { width, height: chartHeight, gap: 6, maxValue: max },
  );

  // y of a value on the plot (accounting for the value-label band at the top).
  const yFor = (value: number) => valueSpace + chartHeight * (1 - Math.min(value, max) / max);
  const refY = referenceLine ? yFor(referenceLine.value) : 0;

  return (
    <View onLayout={onLayout} style={{ width: "100%", height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {bars.map((bar, i) => {
            const datum = data[i];
            const cx = bar.x + bar.width / 2;
            return (
              <G key={i}>
                <Rect x={bar.x} y={bar.y + valueSpace} width={bar.width} height={bar.height} rx={3} fill={datum?.color ?? theme.colors.accent} />
                {showValues ? (
                  <SvgText x={cx} y={bar.y + valueSpace - 4} fill={theme.colors.textMuted} fontSize={10} textAnchor="middle">
                    {formatValue(bar.value)}
                  </SvgText>
                ) : null}
                <SvgText x={cx} y={height - 6} fill={theme.colors.textMuted} fontSize={10} textAnchor="middle">
                  {datum?.label ?? ""}
                </SvgText>
              </G>
            );
          })}
          {referenceLine ? (
            <G>
              <Line x1={0} y1={refY} x2={width} y2={refY} stroke={referenceLine.color} strokeWidth={2} strokeDasharray="6,4" />
              <SvgText x={width} y={refY - 4} fill={referenceLine.color} fontSize={10} fontWeight="bold" textAnchor="end">
                {referenceLine.label}
              </SvgText>
            </G>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
