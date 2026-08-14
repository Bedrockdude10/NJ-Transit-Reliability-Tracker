import { DISCLAIMER_TEXT } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/format";
import { theme } from "../lib/theme";
import { useApi } from "../hooks/useApi";
import { StatusDot } from "./ui";

/**
 * Persistent footer on every screen: a live-collection indicator, last ingest
 * time, and the required disclaimer (PRD compliance).
 */
export function DisclaimerFooter() {
  const { data } = useApi(api.health());
  const lastIngest = data?.feeds.find((f) => f.feedType === "TripUpdates")?.lastSuccessAtMs ?? null;
  const live = lastIngest !== null;

  return (
    <View style={styles.footer}>
      <View style={styles.statusRow}>
        <View style={styles.status}>
          <StatusDot color={live ? theme.colors.good : theme.colors.warn} pulse={live} />
          <Text style={styles.statusText}>{live ? "Live collection" : "Independent data: not collecting yet"}</Text>
        </View>
        <Text style={styles.meta}>
          {data?.collectionStartDate ? `Since ${data.collectionStartDate}` : "Not started"}
          {"  ·  "}
          Last ingest {formatTimestamp(lastIngest)}
        </Text>
      </View>
      <Text style={styles.disclaimer}>{DISCLAIMER_TEXT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing(1),
  },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: theme.spacing(2) },
  status: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  statusText: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, fontWeight: "600" },
  meta: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs },
  disclaimer: { color: theme.colors.textFaint, fontSize: theme.fontSize.xs, fontStyle: "italic" },
});
