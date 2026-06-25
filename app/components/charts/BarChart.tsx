import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { G, Rect, Text as SvgText } from "react-native-svg";
import { barLayout, niceMax } from "../../lib/charts";
import { theme } from "../../lib/theme";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/**
 * Vertical bar chart rendered with react-native-svg (works on web + native).
 * Width is measured from the container so it fills the card responsively.
 */
export function BarChart({
  data,
  height = 180,
  showValues = true,
  formatValue = (v) => String(v),
}: {
  data: readonly BarDatum[];
  height?: number;
  showValues?: boolean;
  formatValue?: (value: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const labelSpace = 20;
  const valueSpace = showValues ? 16 : 0;
  const chartHeight = Math.max(1, height - labelSpace - valueSpace);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const bars = barLayout(
    data.map((d) => d.value),
    { width, height: chartHeight, gap: 6, maxValue: max },
  );

  return (
    <View onLayout={onLayout} style={{ width: "100%", height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {bars.map((bar, i) => {
            const datum = data[i];
            const cx = bar.x + bar.width / 2;
            return (
              <G key={i}>
                <Rect
                  x={bar.x}
                  y={bar.y + valueSpace}
                  width={bar.width}
                  height={bar.height}
                  rx={3}
                  fill={datum?.color ?? theme.colors.accent}
                />
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
        </Svg>
      ) : null}
    </View>
  );
}
