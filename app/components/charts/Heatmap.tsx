import { StyleSheet, Text, View } from "react-native";
import { heatColor } from "../../lib/charts";
import { theme } from "../../lib/theme";

export interface HeatCell {
  label: string;
  value: number;
  observations: number;
}

/**
 * Wrapping grid of colored cells (hour-of-day or day-of-week). Color encodes
 * average delay; cells with no observations are shown muted.
 */
export function Heatmap({ cells, unit = "s" }: { cells: HeatCell[]; unit?: string }) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  return (
    <View style={styles.grid}>
      {cells.map((cell) => {
        const empty = cell.observations === 0;
        return (
          <View
            key={cell.label}
            style={[styles.cell, { backgroundColor: empty ? theme.colors.surfaceAlt : heatColor(cell.value, max) }]}
          >
            <Text style={[styles.cellLabel, !empty && styles.onColor]}>{cell.label}</Text>
            <Text style={[styles.cellValue, !empty && styles.onColor]}>{empty ? "—" : `${Math.round(cell.value)}${unit}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(1) },
  cell: { width: 52, height: 52, borderRadius: 6, alignItems: "center", justifyContent: "center", gap: 2 },
  cellLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "600" },
  cellValue: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  onColor: { color: "#0b1220" },
});
