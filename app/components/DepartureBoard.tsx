import { formatCountdown, minutesUntil, type Departure, type DepartureStatus } from "@njt/shared";
import { StyleSheet, Text, View } from "react-native";
import { formatClockTime, formatDelayShort } from "../lib/format";
import { theme } from "../lib/theme";
import { Badge, EmptyState, Muted, StatusDot } from "./ui";

/**
 * A live platform board: what is coming, where it goes, and how late it is.
 *
 * The countdown is recomputed from `nowMs` on every render rather than taken
 * from the response, so the minutes tick down smoothly between polls instead of
 * freezing until the next refresh lands.
 */

const STATUS_LABEL: Record<DepartureStatus, string> = {
  on_time: "On time",
  late: "Late",
  early: "Early",
  cancelled: "Cancelled",
  skipped: "Not stopping",
  scheduled: "Scheduled",
};

function statusColor(status: DepartureStatus): string {
  switch (status) {
    case "late":
      return theme.colors.bad;
    case "cancelled":
    case "skipped":
      return theme.colors.bad;
    case "early":
      return theme.colors.warn;
    case "on_time":
      return theme.colors.good;
    // No live prediction — neutral, because "unknown" is not "fine".
    case "scheduled":
      return theme.colors.textFaint;
  }
}

export function DepartureBoard({
  departures,
  nowMs,
}: {
  departures: readonly Departure[];
  nowMs: number;
}) {
  if (departures.length === 0) {
    return (
      <EmptyState
        title="Nothing scheduled"
        hint="No trains are due at this station within the next 90 minutes. Service may have ended for the night."
      />
    );
  }

  return (
    <View>
      {departures.map((d) => {
        const minutes = minutesUntil(d.predictedTime ?? d.scheduledTime, nowMs);
        const cancelled = d.status === "cancelled" || d.status === "skipped";
        return (
          <View key={`${d.tripId}-${d.scheduledTime}`} style={styles.row}>
            <View style={styles.countdown}>
              {/* "departed" is far longer than "3 min"; shrink it rather than
                  wrap, so every row keeps the same height and the column of
                  numbers stays scannable. */}
              <Text
                numberOfLines={1}
                style={[
                  styles.countdownText,
                  minutes !== null && minutes < 0 ? styles.countdownPast : null,
                  cancelled && styles.struck,
                ]}
              >
                {formatCountdown(minutes)}
              </Text>
            </View>

            <View style={styles.main}>
              <Text style={[styles.destination, cancelled && styles.struck]} numberOfLines={1}>
                {d.destination ?? d.lineName}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {d.lineName} · {d.direction}
                {d.scheduledTime !== null ? ` · sched ${formatClockTime(d.scheduledTime)}` : ""}
              </Text>
            </View>

            <View style={styles.status}>
              <View style={styles.statusLine}>
                <StatusDot color={statusColor(d.status)} pulse={d.status === "late"} />
                <Text style={[styles.statusText, { color: statusColor(d.status) }]}>{STATUS_LABEL[d.status]}</Text>
              </View>
              {d.delaySeconds !== null && d.status !== "on_time" && d.status !== "scheduled" ? (
                <Muted>{formatDelayShort(d.delaySeconds)}</Muted>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Small header showing how current the board is. */
export function BoardFreshness({ updatedAtMs, nowMs }: { updatedAtMs: number | null; nowMs: number }) {
  if (updatedAtMs === null) return null;
  const seconds = Math.max(0, Math.round((nowMs - updatedAtMs) / 1000));
  const stale = seconds > 90;
  return (
    <View style={styles.freshness}>
      <StatusDot color={stale ? theme.colors.warn : theme.colors.good} pulse={!stale} />
      <Text style={[styles.freshnessText, stale && { color: theme.colors.warn }]}>
        {seconds < 5 ? "live" : `updated ${seconds}s ago`}
      </Text>
    </View>
  );
}

/** Legend explaining that a live board is predictions, not promises. */
export function BoardDisclaimer() {
  return (
    <Muted>
      Times are NJ Transit's own live predictions from the GTFS-Realtime feed, not guarantees. “Scheduled” means the
      feed is not yet tracking that train.
    </Muted>
  );
}

export { STATUS_LABEL as DEPARTURE_STATUS_LABEL };

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(2.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  countdown: { width: 92 },
  countdownText: {
    color: theme.colors.text,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    fontFamily: theme.fontFamily.mono,
  },
  // A train that has gone recedes rather than competing with what's next.
  countdownPast: { color: theme.colors.textFaint, fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  main: { flex: 1, minWidth: 0 },
  destination: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: theme.fontWeight.semibold },
  meta: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, marginTop: 2 },
  status: { alignItems: "flex-end", gap: 2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  statusText: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold },
  struck: { textDecorationLine: "line-through", color: theme.colors.textFaint },
  freshness: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5) },
  freshnessText: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
});
