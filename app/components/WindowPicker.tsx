import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";
import { WINDOWS, type WindowKey } from "../lib/windows";

export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (key: WindowKey, days: number) => void }) {
  return (
    <View style={styles.group}>
      {WINDOWS.map((w) => {
        const active = w.key === value;
        return (
          <Pressable key={w.key} onPress={() => onChange(w.key, w.days)} style={[styles.segment, active && styles.active]}>
            <Text style={[styles.label, active && styles.activeLabel]}>{w.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius, padding: 3, alignSelf: "flex-start" },
  segment: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: theme.radius - 3 },
  active: { backgroundColor: theme.colors.accent },
  label: { color: theme.colors.textMuted, fontWeight: "600", fontSize: theme.fontSize.sm },
  activeLabel: { color: theme.colors.background },
});
