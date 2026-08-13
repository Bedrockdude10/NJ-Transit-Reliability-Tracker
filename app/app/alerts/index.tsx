import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { availableEffects, isMeaningfulEffect } from "../../lib/alerts";
import { api } from "../../lib/api";
import { formatTimestamp, humanizeEffect } from "../../lib/format";
import { theme } from "../../lib/theme";
import { windowToRange } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { Table } from "../../components/Table";
import { Badge, Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, Screen } from "../../components/ui";

const PAGE_SIZE = 20;

interface ChipOption {
  label: string;
  value: string | undefined;
}

function Chips({ options, value, onSelect }: { options: ChipOption[]; value: string | undefined; onSelect: (v: string | undefined) => void }) {
  const all: ChipOption[] = [{ label: "All", value: undefined }, ...options];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {all.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable key={opt.label} onPress={() => onSelect(opt.value)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function Alerts() {
  const range = useMemo(() => windowToRange(90), []);
  const [page, setPage] = useState(1);
  const [line, setLine] = useState<string | undefined>();
  const [effect, setEffect] = useState<string | undefined>();

  const lines = useApi(() => api.lines(), []);
  const list = useApi(
    () => api.alerts({ page, pageSize: PAGE_SIZE, line, effect_type: effect, ...range }),
    [page, line, effect, range.from, range.to],
  );
  const freq = useApi(() => api.alertFrequency(range), [range.from, range.to]);
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  // NJT doesn't populate GTFS-RT `effect`, so offer only effects the data has.
  const effects = useMemo(() => availableEffects(freq.data), [freq.data]);

  const selectLine = (v: string | undefined) => {
    setLine(v);
    setPage(1);
  };
  const selectEffect = (v: string | undefined) => {
    setEffect(v);
    setPage(1);
  };

  return (
    <Screen>
      <PageTitle title="Service Alerts" subtitle="Ingested NJT rail alerts, last 90 days" />

      <Card>
        <SectionTitle>Alert frequency by line</SectionTitle>
        {freq.data ? (
          <Table
            columns={[
              { key: "line", label: "Line", flex: 2 },
              { key: "total", label: "Total", align: "right" },
            ]}
            rows={freq.data.byLine.map((l) => ({ line: l.lineName, total: l.total }))}
          />
        ) : (
          <Loading />
        )}
      </Card>

      <Card>
        <SectionTitle>Alert log</SectionTitle>
        <Text style={styles.filterLabel}>Filter by line</Text>
        <Chips options={(lines.data?.lines ?? []).map((l) => ({ label: l.shortName, value: l.id }))} value={line} onSelect={selectLine} />
        {effects.length > 0 ? (
          <>
            <Text style={styles.filterLabel}>Filter by effect</Text>
            <Chips options={effects.map((e) => ({ label: humanizeEffect(e), value: e }))} value={effect} onSelect={selectEffect} />
          </>
        ) : null}

        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : null}
        {list.data?.alerts.map((alert) => (
          <View key={alert.alertId} style={styles.alert}>
            <View style={styles.alertHead}>
              <Text style={styles.alertTitle}>{alert.headerText}</Text>
              {isMeaningfulEffect(alert.effectType) ? <Badge text={humanizeEffect(alert.effectType)} /> : null}
            </View>
            <Muted>{alert.descriptionText}</Muted>
            <Text style={styles.meta}>
              {alert.affectedRoutes.join(", ") || "—"} · seen {formatTimestamp(alert.ingestedAtMs)}
            </Text>
          </View>
        ))}
        {list.data && list.data.alerts.length === 0 ? <Muted>No alerts match these filters.</Muted> : null}

        <Row>
          <Pressable disabled={page <= 1} onPress={() => setPage((p) => p - 1)} style={[styles.pageBtn, page <= 1 && styles.disabled]}>
            <Text style={styles.pageText}>‹ Prev</Text>
          </Pressable>
          <Text style={styles.pageInfo}>
            Page {page} of {totalPages}
          </Text>
          <Pressable disabled={page >= totalPages} onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, page >= totalPages && styles.disabled]}>
            <Text style={styles.pageText}>Next ›</Text>
          </Pressable>
        </Row>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs, textTransform: "uppercase", letterSpacing: 0.5, marginTop: theme.spacing(1) },
  chips: { gap: theme.spacing(2), paddingVertical: theme.spacing(1) },
  chip: { paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(1), borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  chipActive: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.textMuted, fontSize: theme.fontSize.sm, fontWeight: "600" },
  chipTextActive: { color: theme.colors.background },
  alert: { gap: theme.spacing(1), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  alertHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2) },
  alertTitle: { color: theme.colors.text, fontWeight: "700", fontSize: theme.fontSize.md, flex: 1 },
  meta: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  pageBtn: { backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: theme.radius },
  disabled: { opacity: 0.4 },
  pageText: { color: theme.colors.text, fontWeight: "600" },
  pageInfo: { color: theme.colors.textMuted, alignSelf: "center" },
});
