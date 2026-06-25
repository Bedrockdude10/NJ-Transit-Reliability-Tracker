import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { Card, ErrorView, Loading, Muted, PageTitle, Screen } from "../../components/ui";

export default function StationsList() {
  const { data, loading, error, reload } = useApi(() => api.stations(), []);
  const [query, setQuery] = useState("");

  const stations = useMemo(() => {
    const all = data?.stations ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((s) => s.stopName.toLowerCase().includes(q)) : all;
  }, [data, query]);

  return (
    <Screen>
      <PageTitle title="Stations" subtitle="Search a station for arrival delays and patterns" />
      <TextInput
        style={styles.search}
        placeholder="Search stations…"
        placeholderTextColor={theme.colors.textMuted}
        value={query}
        onChangeText={setQuery}
      />
      {loading ? <Loading /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}
      {stations.map((station) => (
        <Link key={station.stopId} href={`/stations/${station.stopId}`} asChild>
          <Pressable>
            <Card style={styles.station}>
              <View style={styles.main}>
                <Text style={styles.name}>{station.stopName}</Text>
                <Muted>{station.lines.join(" · ")}</Muted>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        </Link>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: theme.fontSize.md,
  },
  station: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  main: { gap: theme.spacing(1), flex: 1 },
  name: { color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: "700" },
  chevron: { color: theme.colors.textMuted, fontSize: 28 },
});
