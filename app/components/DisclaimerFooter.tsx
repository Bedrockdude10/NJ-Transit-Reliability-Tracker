import { DISCLAIMER_TEXT } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/format";
import { theme } from "../lib/theme";
import { useApi } from "../hooks/useApi";
import { QueryBoundary } from "./QueryBoundary";
import { StatusDot } from "./ui";

/**
 * Persistent footer on every screen: a live-collection indicator, last ingest
 * time, and the required disclaimer (PRD compliance).
 */
export function DisclaimerFooter() {
  return (
    <View style={styles.footer}>
      {/* The status line needs /health; the disclaimer does not, and is a
          compliance requirement — so it must render even when the API is
          unreachable. This boundary is what keeps the two independent.

          It also has to exist at all: this footer sits in the root layout, so
          before it had one, a suspending health query held up the entire app
          shell and a failing one escaped to the root with nothing to catch it.
          Every screen was blank, not just the footer. */}
      <QueryBoundary
        pending={<View style={styles.statusRow} />}
        failed={() => (
          <View style={styles.statusRow}>
            <View style={styles.status}>
              <StatusDot color={theme.colors.warn} />
              <Text style={styles.statusText}>Collection status unavailable</Text>
            </View>
          </View>
        )}
      >
        <CollectionStatus />
      </QueryBoundary>
      <Text style={styles.disclaimer}>{DISCLAIMER_TEXT}</Text>
    </View>
  );
}

function CollectionStatus() {
  const { data } = useApi(api.health());
  const lastIngest = data.feeds.find((f) => f.feedType === "TripUpdates")?.lastSuccessAtMs ?? null;
  const live = lastIngest !== null;

  return (
    <View style={styles.statusRow}>
      <View style={styles.status}>
        <StatusDot color={live ? theme.colors.good : theme.colors.warn} pulse={live} />
        <Text style={styles.statusText}>{live ? "Live collection" : "Independent data: not collecting yet"}</Text>
      </View>
      <Text style={styles.meta}>
        {data.collectionStartDate ? `Since ${data.collectionStartDate}` : "Not started"}
        {"  ·  "}
        Last ingest {formatTimestamp(lastIngest)}
      </Text>
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
