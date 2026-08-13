import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../lib/theme";

export interface PickableStation {
  stopId: string;
  stopName: string;
  lines: string[];
}

/**
 * Type-to-filter station chooser.
 *
 * NJ Transit has ~160 stations, which is too many for a dropdown and too few to
 * need a remote search, so the whole list is filtered client-side. The current
 * choice stays visible while searching — picking a commute means comparing two
 * ends, and losing sight of one while choosing the other makes that harder.
 */
export function StationPicker({
  label,
  stations,
  value,
  onChange,
  exclude,
}: {
  label: string;
  stations: readonly PickableStation[];
  value: string | null;
  onChange: (stopId: string) => void;
  /** A stop to omit — you cannot travel from a station to itself. */
  exclude?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = stations.find((s) => s.stopId === value) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stations
      .filter((s) => s.stopId !== exclude)
      .filter((s) => (q === "" ? true : s.stopName.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [stations, query, exclude]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setOpen((o) => !o)}>
        <Text style={selected ? styles.value : styles.placeholder} numberOfLines={1}>
          {selected ? selected.stopName : "Choose a station"}
        </Text>
        <Text style={styles.chev}>{open ? "▲" : "▼"}</Text>
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${stations.length} stations…`}
            placeholderTextColor={theme.colors.textFaint}
            style={styles.search}
            autoCorrect={false}
          />
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {matches.map((s) => (
              <Pressable
                key={s.stopId}
                style={[styles.option, s.stopId === value && styles.optionActive]}
                onPress={() => {
                  onChange(s.stopId);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <Text style={styles.optionName}>{s.stopName}</Text>
                <Text style={styles.optionLines} numberOfLines={1}>
                  {s.lines.join(" · ")}
                </Text>
              </Pressable>
            ))}
            {matches.length === 0 ? <Text style={styles.empty}>No station matches “{query}”.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 220, gap: theme.spacing(1) },
  label: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
  },
  value: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "600", flex: 1 },
  placeholder: { color: theme.colors.textFaint, fontSize: theme.fontSize.md, flex: 1 },
  chev: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  panel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    overflow: "hidden",
  },
  search: {
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
    fontSize: theme.fontSize.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  list: { maxHeight: 260 },
  option: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  optionActive: { backgroundColor: theme.colors.surfaceHover },
  optionName: { color: theme.colors.text, fontSize: theme.fontSize.sm, fontWeight: "600" },
  optionLines: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs, marginTop: 1 },
  empty: { color: theme.colors.textMuted, padding: theme.spacing(3), fontSize: theme.fontSize.sm },
});
