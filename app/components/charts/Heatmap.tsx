import { StyleSheet, Text, View } from "react-native";
import { heatColor } from "../../lib/charts";
import { theme } from "../../lib/theme";

export interface HeatCell {
  label: string;
  value: number;
  observations: number;
}

/** Cells with no observations are muted, not coloured at the ramp's low end. */
export function Heatmap({ cells, unit = "s" }: { cells: HeatCell[]; unit?: string }) {
  const withData = cells.filter((c) => c.observations > 0);
  const max = Math.max(1, ...cells.map((c) => c.value));
  const min = withData.length ? Math.min(...withData.map((c) => c.value)) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {cells.map((cell) => {
          const empty = cell.observations === 0;
          return (
            <View key={cell.label} style={[styles.cell, { backgroundColor: empty ? theme.colors.surfaceAlt : heatColor(cell.value, max) }]}>
              <Text style={[styles.cellLabel, !empty && styles.onColor]}>{cell.label}</Text>
              <Text style={[styles.cellValue, !empty && styles.onColor]}>{empty ? "—" : `${Math.round(cell.value)}${unit}`}</Text>
            </View>
          );
        })}
      </View>
      {withData.length > 0 ? (
        <View style={styles.legend}>
          <Text style={styles.legendText}>{Math.round(min)}{unit}</Text>
          <View style={styles.ramp}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <View key={t} style={[styles.rampCell, { backgroundColor: heatColor(t, 1) }]} />
            ))}
          </View>
          <Text style={styles.legendText}>{Math.round(max)}{unit} avg delay</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing(3) },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(1) },
  cell: { width: 54, height: 54, borderRadius: theme.radii.sm, alignItems: "center", justifyContent: "center", gap: 2 },
  cellLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "700" },
  cellValue: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "600" },
  onColor: { color: "#0b1220" },
  legend: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  ramp: { flexDirection: "row", borderRadius: theme.radii.pill, overflow: "hidden" },
  rampCell: { width: 22, height: 8 },
  legendText: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },
});
