import { StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";

export interface Column {
  key: string;
  label: string;
  flex?: number;
  align?: "left" | "right";
}

export type TableRow = Record<string, string | number>;

/** Minimal responsive table. Cells are pre-formatted strings/numbers. */
export function Table({ columns, rows }: { columns: Column[]; rows: TableRow[] }) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map((col) => (
          <Text key={col.key} style={[styles.headerCell, cellStyle(col)]} numberOfLines={1}>
            {col.label}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={[styles.row, i % 2 ? styles.zebra : null]}>
          {columns.map((col) => (
            <Text key={col.key} style={[styles.cell, cellStyle(col)]} numberOfLines={1}>
              {String(row[col.key] ?? "")}
            </Text>
          ))}
        </View>
      ))}
      {rows.length === 0 ? <Text style={styles.empty}>No data for this period.</Text> : null}
    </View>
  );
}

function cellStyle(col: Column) {
  return { flex: col.flex ?? 1, textAlign: col.align ?? "left" } as const;
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, overflow: "hidden" },
  row: { flexDirection: "row", paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), gap: theme.spacing(2) },
  headerRow: { backgroundColor: theme.colors.surfaceAlt },
  zebra: { backgroundColor: theme.colors.surfaceAlt },
  headerCell: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "700", textTransform: "uppercase" },
  cell: { color: theme.colors.text, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.textMuted, padding: theme.spacing(3), textAlign: "center" },
});
