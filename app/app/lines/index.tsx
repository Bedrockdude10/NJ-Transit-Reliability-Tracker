import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { formatMonth, formatPercent } from "../../lib/format";
import { otpColor, otpColorSoft, theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { GradeBadge } from "../../components/Indicators";
import { Badge, Card, EmptyState, ErrorView, Loading, PageTitle, Screen } from "../../components/ui";

export default function LinesList() {
  const { data, loading, error, reload } = useApi(api.lines());

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

      {lines.length > 0 ? (
        <Card style={styles.list}>
          {lines.map((line, i) => {
            const otp = line.njtOtpPercent;
            const color = otp !== null ? otpColor(otp) : theme.colors.textFaint;
            return (
              <Link key={line.id} href={`/lines/${line.id}`} asChild>
                <Pressable style={StyleSheet.flatten([styles.row, i > 0 && styles.rowBorder])}>
                  {/* The row doubles as a reliability bar: a soft fill to OTP%. */}
                  {otp !== null ? <View style={[styles.fill, { width: `${otp}%`, backgroundColor: otpColorSoft(otp) }]} /> : null}
                  <View style={styles.rowContent}>
                    <View style={[styles.dot, { backgroundColor: line.color ? `#${line.color}` : theme.colors.border }]} />
                    <View style={styles.nameCol}>
                      <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                      <View style={styles.tags}>
                        <Badge text={line.shortName} />
                        {line.hasAmtrakAttribution ? <Badge text="Amtrak" color={theme.colors.njt} tint={theme.colors.njtSoft} /> : null}
                      </View>
                    </View>
                    <View style={styles.stats}>
                      <Text style={[styles.otp, { color }]}>{formatPercent(otp)}</Text>
                      <Text style={styles.sub}>
                        {line.njtCancellationRatePercent !== null ? `${line.njtCancellationRatePercent}% cancelled` : "no NJT data"}
                        {line.njtLatestMonth ? ` · ${formatMonth(`${line.njtLatestMonth}-01`)}` : ""}
                      </Text>
                    </View>
                    {otp !== null ? <GradeBadge otpPercent={otp} size={42} /> : null}
                  </View>
                </Pressable>
              </Link>
            );
          })}
        </Card>
      ) : null}

      {data && data.lines.length === 0 ? (
        <EmptyState title="No lines yet" hint="The pipeline hasn't ingested a GTFS schedule." />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 0, overflow: "hidden" },
  row: { position: "relative", paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3) },
  rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  rowContent: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  nameCol: { flex: 1, gap: theme.spacing(1), flexShrink: 1 },
  lineName: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "700" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(1) },
  stats: { alignItems: "flex-end", gap: 2 },
  otp: { fontSize: theme.fontSize.xl, fontWeight: "800", letterSpacing: -0.5 },
  sub: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
});
