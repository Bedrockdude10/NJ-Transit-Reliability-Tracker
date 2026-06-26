import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { formatMonth, formatPercent } from "../../lib/format";
import { otpColor, theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { Badge, Card, ErrorView, Loading, PageTitle, Screen } from "../../components/ui";

export default function LinesList() {
  const { data, loading, error, reload } = useApi(() => api.lines(), []);

  // Rank by NJT's reported OTP, least reliable first; lines without data last.
  const lines = [...(data?.lines ?? [])].sort((a, b) => {
    if (a.njtOtpPercent === null) return 1;
    if (b.njtOtpPercent === null) return -1;
    return a.njtOtpPercent - b.njtOtpPercent;
  });

  return (
    <Screen>
      <PageTitle title="Lines" subtitle="Ranked by NJT's reported on-time % (latest month) — least reliable first" />
      {loading ? <Loading /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {lines.map((line) => (
        <Link key={line.id} href={`/lines/${line.id}`} asChild>
          <Pressable>
            <Card style={styles.line}>
              <View style={styles.lineMain}>
                <View style={styles.nameRow}>
                  {line.color ? <View style={[styles.dot, { backgroundColor: `#${line.color}` }]} /> : null}
                  <Text style={styles.lineName}>{line.name}</Text>
                </View>
                <View style={styles.badges}>
                  <Badge text={line.shortName} color={theme.colors.surfaceAlt} />
                  {line.hasAmtrakAttribution ? <Badge text="Amtrak-attributed" color={theme.colors.surfaceAlt} /> : null}
                </View>
              </View>
              <View style={styles.stats}>
                <Text style={[styles.otp, { color: line.njtOtpPercent !== null ? otpColor(line.njtOtpPercent) : theme.colors.textMuted }]}>
                  {formatPercent(line.njtOtpPercent)}
                </Text>
                <Text style={styles.sub}>
                  {line.njtCancellationRatePercent !== null ? `${line.njtCancellationRatePercent}% cancelled` : "no NJT data"}
                  {line.njtLatestMonth ? ` · ${formatMonth(`${line.njtLatestMonth}-01`)}` : ""}
                </Text>
              </View>
            </Card>
          </Pressable>
        </Link>
      ))}
      {data && data.lines.length === 0 ? (
        <Card>
          <Text style={styles.sub}>No lines yet — the pipeline hasn’t ingested a GTFS schedule.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2) },
  lineMain: { gap: theme.spacing(2), flexShrink: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  lineName: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "700", flexShrink: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
  stats: { alignItems: "flex-end" },
  otp: { fontSize: theme.fontSize.xl, fontWeight: "800" },
  sub: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
});
