import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { availableEffects, isMeaningfulEffect } from "../lib/alerts";
import { api, type DateRange } from "../lib/api";
import { formatTimestamp, humanizeEffect } from "../lib/format";
import { theme } from "../lib/theme";
import { windowToRange } from "../lib/windows";
import { useApi } from "../hooks/useApi";
import { Table } from "../components/Table";
import { QueryBoundary } from "../components/QueryBoundary";
import { Badge, Card, Muted, PageTitle, Row, SectionTitle } from "../components/ui";

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

export function AlertsPanel() {
  const range = useMemo(() => windowToRange(90), []);
  const [page, setPage] = useState(1);
  const [line, setLine] = useState<string | undefined>();
  const [effect, setEffect] = useState<string | undefined>();

  const selectLine = (v: string | undefined) => {
    setLine(v);
    setPage(1);
  };
  const selectEffect = (v: string | undefined) => {
    setEffect(v);
    setPage(1);
  };

  return (
    <>
      <PageTitle title="Service Alerts" subtitle="Ingested NJT rail alerts, last 90 days" />

      {/* Frequency and log load independently — the log re-fetches on every
          filter change and there is no reason for that to blank the summary. */}
      <QueryBoundary>
        <AlertFrequency range={range} />
      </QueryBoundary>

      <QueryBoundary>
        <AlertLog
          range={range}
          page={page}
          onPage={setPage}
          line={line}
          onLine={selectLine}
          effect={effect}
          onEffect={selectEffect}
        />
      </QueryBoundary>
    </>
  );
}

function AlertFrequency({ range }: { range: Required<DateRange> }) {
  const { data } = useApi(api.alertFrequency(range));
  return (
    <Card>
      <SectionTitle>Alert frequency by line</SectionTitle>
      <Table
        columns={[
          { key: "line", label: "Line", flex: 2 },
          { key: "total", label: "Total", align: "right" },
        ]}
        rows={data.byLine.map((l) => ({ line: l.lineName, total: l.total }))}
      />
    </Card>
  );
}

function AlertLog({
  range,
  page,
  onPage,
  line,
  onLine,
  effect,
  onEffect,
}: {
  range: Required<DateRange>;
  page: number;
  onPage: (fn: (p: number) => number) => void;
  line: string | undefined;
  onLine: (v: string | undefined) => void;
  effect: string | undefined;
  onEffect: (v: string | undefined) => void;
}) {
  const lines = useApi(api.lines());
  const freq = useApi(api.alertFrequency(range));
  const { data } = useApi(api.alerts({ page, pageSize: PAGE_SIZE, line, effect_type: effect, ...range }));

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  // NJT doesn't populate GTFS-RT `effect`, so offer only effects the data has.
  const effects = useMemo(() => availableEffects(freq.data), [freq.data]);

  return (
    <Card>
      <SectionTitle>Alert log</SectionTitle>
      <Text style={styles.filterLabel}>Filter by line</Text>
      <Chips options={lines.data.lines.map((l) => ({ label: l.shortName, value: l.id }))} value={line} onSelect={onLine} />
      {effects.length > 0 ? (
        <>
          <Text style={styles.filterLabel}>Filter by effect</Text>
          <Chips options={effects.map((e) => ({ label: humanizeEffect(e), value: e }))} value={effect} onSelect={onEffect} />
        </>
      ) : null}

      {data.alerts.map((alert) => (
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
      {data.alerts.length === 0 ? <Muted>No alerts match these filters.</Muted> : null}

      <Row>
        <Pressable disabled={page <= 1} onPress={() => onPage((p) => p - 1)} style={[styles.pageBtn, page <= 1 && styles.disabled]}>
          <Text style={styles.pageText}>‹ Prev</Text>
        </Pressable>
        <Text style={styles.pageInfo}>
          Page {page} of {totalPages}
        </Text>
        <Pressable disabled={page >= totalPages} onPress={() => onPage((p) => p + 1)} style={[styles.pageBtn, page >= totalPages && styles.disabled]}>
          <Text style={styles.pageText}>Next ›</Text>
        </Pressable>
      </Row>
    </Card>
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
