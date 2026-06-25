import { DISCLAIMER_TEXT } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/format";
import { theme } from "../lib/theme";
import { useApi } from "../hooks/useApi";

/**
 * Persistent footer shown on every screen: collection start, last ingest, and
 * the required disclaimer (PRD compliance).
 */
export function DisclaimerFooter() {
  const { data } = useApi(() => api.health(), []);
  const lastIngest = data?.feeds.find((f) => f.feedType === "TripUpdates")?.lastSuccessAtMs ?? null;

  return (
    <View style={styles.footer}>
      <Text style={styles.meta}>
        {data?.collectionStartDate ? `Collecting since ${data.collectionStartDate}` : "Collection not started"}
        {"  ·  "}
        Last ingest: {formatTimestamp(lastIngest)}
      </Text>
      <Text style={styles.disclaimer}>{DISCLAIMER_TEXT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing(1),
  },
  meta: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  disclaimer: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontStyle: "italic" },
});
