import type { PropagationStop } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { formatDelayShort } from "../lib/format";
import { theme } from "../lib/theme";
import { Muted } from "./ui";

/**
 * Delay along a route, drawn as a horizontal bar per stop.
 *
 * A line chart would imply delay varies continuously between stops; it doesn't
 * — it is only ever measured *at* stops. Bars keep each stop a discrete
 * reading, and the per-segment change is shown as its own signed number so the
 * question "where did this come from?" is answered by looking down one column.
 */
export function PropagationChart({ stops }: { stops: readonly PropagationStop[] }) {
  const measured = stops.filter((s) => s.avgDelaySeconds !== null);
  if (measured.length < 2) {
    return <Muted>Not enough measured stops on this route yet to trace where delay accumulates.</Muted>;
  }

  const max = Math.max(...measured.map((s) => Math.abs(s.avgDelaySeconds as number)), 60);

  return (
    <View>
      {stops.map((s) => {
        const avg = s.avgDelaySeconds;
        const width = avg === null ? 0 : Math.min(100, (Math.abs(avg) / max) * 100);
        const early = avg !== null && avg < 0;
        const delta = s.deltaSeconds;
        // formatDelayShort collapses anything under 30s to "0"; signing that
        // would print "−0", which reads as a measurement rather than a rounding.
        const deltaText =
          delta === null
            ? ""
            : formatDelayShort(Math.abs(delta)) === "0"
              ? "0"
              : `${delta > 0 ? "+" : "−"}${formatDelayShort(Math.abs(delta))}`;
        return (
          <View key={s.stopId} style={styles.row}>
            <Text style={styles.name} numberOfLines={1}>
              {s.stopName}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { width: `${width}%`, backgroundColor: early ? theme.colors.good : theme.colors.warn },
                ]}
              />
            </View>
            <Text style={styles.value}>{avg === null ? "—" : formatDelayShort(avg)}</Text>
            <Text
              style={[
                styles.delta,
                delta === null || deltaText === "0"
                  ? styles.deltaNeutral
                  : delta > 0
                    ? styles.deltaWorse
                    : styles.deltaBetter,
              ]}
            >
              {deltaText}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2), paddingVertical: theme.spacing(1.5) },
  name: { color: theme.colors.text, fontSize: theme.fontSize.sm, width: 150 },
  barTrack: { flex: 1, height: 10, backgroundColor: theme.colors.track, borderRadius: 5, overflow: "hidden" },
  bar: { height: 10, borderRadius: 5 },
  value: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, width: 58, textAlign: "right", fontFamily: theme.fontFamily.mono },
  delta: { fontSize: theme.fontSize.xs, width: 58, textAlign: "right", fontFamily: theme.fontFamily.mono },
  deltaNeutral: { color: theme.colors.textFaint },
  deltaWorse: { color: theme.colors.bad },
  deltaBetter: { color: theme.colors.good },
});
