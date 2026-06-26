import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { Card, EmptyState, ErrorView, Loading, PageTitle, Screen } from "../../components/ui";

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

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.search}
          placeholder={`Search ${data?.stations.length ?? ""} stations…`}
          placeholderTextColor={theme.colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>

      {loading ? <Loading /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}

      {stations.length > 0 ? (
        <Card style={styles.list}>
          {stations.map((station, i) => (
            <Link key={station.stopId} href={`/stations/${station.stopId}`} asChild>
              <Pressable style={StyleSheet.flatten([styles.row, i > 0 && styles.rowBorder])}>
                <View style={styles.main}>
                  <Text style={styles.name} numberOfLines={1}>{station.stopName}</Text>
                  <Text style={styles.lines} numberOfLines={1}>{station.lines.join(" · ") || "—"}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </Link>
          ))}
        </Card>
      ) : null}

      {data && stations.length === 0 ? (
        <EmptyState title={query ? "No matches" : "No stations yet"} hint={query ? `Nothing matches “${query}”.` : "The pipeline hasn't ingested a GTFS schedule."} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing(4) },
  searchIcon: { color: theme.colors.textFaint, fontSize: 20, marginRight: theme.spacing(2) },
  search: { flex: 1, paddingVertical: theme.spacing(3), color: theme.colors.text, fontSize: theme.fontSize.md },
  list: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3), paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3) },
  rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  main: { flex: 1, gap: 2 },
  name: { color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: "700" },
  lines: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  chevron: { color: theme.colors.textFaint, fontSize: 24 },
});
