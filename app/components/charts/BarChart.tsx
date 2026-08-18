import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { axisTicks, barLayout, niceMax } from "../../lib/charts";
import { useChartColors } from "../../lib/useChartColors";

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

/** Width is measured from the container, so the chart fills its card. */
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
  const c = useChartColors();
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const labelSpace = 20;
  const valueSpace = showValues ? 16 : 4;
  const chartHeight = Math.max(1, height - labelSpace - valueSpace);
  const max = maxValue ?? niceMax(Math.max(0, ...data.map((d) => d.value)));
  const bars = barLayout(
    data.map((d) => d.value),
    { width, height: chartHeight, gap: 8, maxValue: max },
  );

  // Accounts for the value-label band at the top.
  const yFor = (value: number) => valueSpace + chartHeight * (1 - Math.min(value, max) / max);
  const refY = referenceLine ? yFor(referenceLine.value) : 0;

  return (
    <View onLayout={onLayout} style={{ width: "100%", height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* gridlines */}
          {axisTicks(max, 4).map((t, i) => (
            <Line key={`g${i}`} x1={0} y1={yFor(t)} x2={width} y2={yFor(t)} stroke={c.gridLine} strokeWidth={1} />
          ))}

          {bars.map((bar, i) => {
            const datum = data[i];
            const cx = bar.x + bar.width / 2;
            return (
              <G key={i}>
                <Rect x={bar.x} y={bar.y + valueSpace} width={bar.width} height={Math.max(bar.height, bar.value > 0 ? 2 : 0)} rx={4} fill={datum?.color ?? c.accent} />
                {showValues ? (
                  <SvgText x={cx} y={bar.y + valueSpace - 5} fill={c.textMuted} fontSize={10} fontWeight="600" textAnchor="middle">
                    {formatValue(bar.value)}
                  </SvgText>
                ) : null}
                <SvgText x={cx} y={height - 5} fill={c.textFaint} fontSize={10} textAnchor="middle">
                  {datum?.label ?? ""}
                </SvgText>
              </G>
            );
          })}

          {referenceLine ? (
            <G>
              <Line x1={0} y1={refY} x2={width} y2={refY} stroke={referenceLine.color} strokeWidth={2} strokeDasharray="6,4" />
              <SvgText x={width} y={refY - 5} fill={referenceLine.color} fontSize={10} fontWeight="bold" textAnchor="end">
                {referenceLine.label}
              </SvgText>
            </G>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
