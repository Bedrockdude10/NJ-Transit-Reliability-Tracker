import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { theme } from "../lib/theme";

/** Opens a CSV export URL (downloads on web, opens in browser on native). */
export function CsvExportButton({ url }: { url: string }) {
  return (
    <Pressable style={styles.button} onPress={() => void Linking.openURL(url)} accessibilityRole="button">
      <Text style={styles.text}>⬇ Export CSV</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  text: { color: theme.colors.accent, fontWeight: "600", fontSize: theme.fontSize.sm },
});
