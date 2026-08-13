import type { LineTrend } from "@njt/shared";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatInt, formatPercent } from "../lib/format";
import { theme } from "../lib/theme";
import { EmptyState, Muted } from "./ui";

/**
 * Lines ordered by how much their on-time rate moved.
 *
 * Only changes the underlying test could separate from chance are coloured;
 * everything else reads as unchanged, however large the raw swing looks. That
 * restraint is the feature — a list that cried wolf on every quiet line would
 * be worse than no list.
 */
export function TrendList({ trends }: { trends: readonly LineTrend[] }) {
  const comparable = trends.filter((t) => t.enoughData);
  if (comparable.length === 0) {
    return (
      <EmptyState
        title="Not enough history yet"
        hint="Comparing two periods needs a meaningful number of trips in each. This fills in as collection continues."
      />
    );
  }

  return (
    <View>
      {comparable.map((t) => {
        const moved = t.direction !== "stable";
        const color =
          t.direction === "worsening" ? theme.colors.bad : t.direction === "improving" ? theme.colors.good : theme.colors.textFaint;
        return (
          <Link key={t.lineId} href={`/lines/${t.lineId}`} asChild>
            <Pressable style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.name} numberOfLines={1}>
                  {t.lineName}
                </Text>
                <Text style={styles.meta}>
                  {formatPercent(t.priorOtpPercent)} → {formatPercent(t.recentOtpPercent)} · {formatInt(t.recentTrips)} trips
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.delta, { color }]}>
                  {t.deltaPoints === null ? "—" : `${t.deltaPoints > 0 ? "+" : ""}${t.deltaPoints} pts`}
                </Text>
                <Text style={[styles.verdict, { color }]}>
                  {moved ? (t.direction === "worsening" ? "worse" : "better") : "no real change"}
                </Text>
              </View>
            </Pressable>
          </Link>
        );
      })}
      <Muted>
        Only changes unlikely to be chance are called; a line running few trains needs a bigger swing before it counts.
        This is a screen for what deserves a look, not proof of a cause.
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  main: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "600" },
  meta: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, marginTop: 2 },
  right: { alignItems: "flex-end" },
  delta: { fontSize: theme.fontSize.md, fontWeight: "800", fontFamily: theme.fontFamily.mono },
  verdict: { fontSize: theme.fontSize.xs, fontWeight: "600" },
});
