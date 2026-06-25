import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { Badge, Card, ErrorView, Loading, PageTitle, Screen } from "../../components/ui";

export default function LinesList() {
  const { data, loading, error, reload } = useApi(() => api.lines(), []);

  return (
    <Screen>
      <PageTitle title="Lines" subtitle="Tap a line for its detailed reliability breakdown" />
      {loading ? <Loading /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {data?.lines.map((line) => (
        <Link key={line.id} href={`/lines/${line.id}`} asChild>
          <Pressable>
            <Card style={styles.line}>
              <View style={styles.lineMain}>
                <Text style={styles.lineName}>{line.name}</Text>
                <View style={styles.badges}>
                  <Badge text={line.shortName} color={theme.colors.surfaceAlt} />
                  {line.hasAmtrakAttribution ? <Badge text="Amtrak-attributed" color={theme.colors.surfaceAlt} /> : null}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        </Link>
      ))}
      {data && data.lines.length === 0 ? (
        <Card>
          <Text style={styles.empty}>No lines yet — the pipeline hasn’t ingested a GTFS schedule.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineMain: { gap: theme.spacing(2) },
  lineName: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "700" },
  badges: { flexDirection: "row", gap: theme.spacing(2) },
  chevron: { color: theme.colors.textMuted, fontSize: 28 },
  empty: { color: theme.colors.textMuted },
});
