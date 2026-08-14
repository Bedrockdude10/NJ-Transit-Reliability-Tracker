import { Link } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { formatDelayShort, formatInt, formatPercent } from "../../lib/format";
import { theme } from "../../lib/theme";
import { windowToRange } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { Table } from "../../components/Table";
import { Card, EmptyState, ErrorView, Loading, Muted, PageTitle, SegmentedControl, Screen } from "../../components/ui";

export default function StationsList() {
  const { data, loading, error, reload } = useApi(api.stations());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"delay" | "amplification">("delay");
  const range = useMemo(() => windowToRange(30), []);
  const rankings = useApi(api.stationRankings(range, sort));

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

      {/* Rankings before the list: an alphabetical index answers "where is X?",
          but the operationally useful question is "which stations are worst?" */}
      <Card
        title="Least reliable stations"
        subtitle={sort === "delay" ? "Where trains arrive latest" : "Where stations add delay of their own"}
        right={
          <SegmentedControl
            value={sort}
            onChange={setSort}
            options={[
              { key: "delay", label: "Arrival delay" },
              { key: "amplification", label: "Added here" },
            ]}
          />
        }
      >
        {rankings.data ? (
          rankings.data.stations.length > 0 ? (
            <>
              <Table
                columns={[
                  { key: "name", label: "Station", flex: 2.4 },
                  { key: "metric", label: sort === "delay" ? "Avg delay" : "Amplified", align: "right" },
                  { key: "obs", label: "Obs", align: "right" },
                ]}
                rows={rankings.data.stations.map((s) => ({
                  name: s.stopName,
                  metric:
                    sort === "delay"
                      ? formatDelayShort(s.avgArrivalDelaySeconds)
                      : formatPercent(s.amplificationRatePercent),
                  obs: formatInt(s.observations),
                }))}
              />
              <Muted>
                “Added here” counts trains that arrived within 5 minutes but still left late — delay the station
                introduces rather than inherits, which is the kind an operator can act on.
                {rankings.data.excludedLowSample > 0
                  ? ` ${rankings.data.excludedLowSample} station${rankings.data.excludedLowSample === 1 ? "" : "s"} withheld — under 30 observations.`
                  : ""}
              </Muted>
            </>
          ) : (
            <EmptyState
              title="Not enough data yet"
              hint="Ranking needs a meaningful number of observations per station, or a quiet stop tops the chart on luck. This fills in as collection continues."
            />
          )
        ) : (
          <Loading />
        )}
      </Card>

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
