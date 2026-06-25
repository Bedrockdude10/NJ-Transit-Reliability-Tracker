import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { formatTimestamp, humanizeEffect } from "../../lib/format";
import { theme } from "../../lib/theme";
import { windowToRange } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { Table } from "../../components/Table";
import { Badge, Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, Screen } from "../../components/ui";

const PAGE_SIZE = 20;

export default function Alerts() {
  const range = useMemo(() => windowToRange(90), []);
  const [page, setPage] = useState(1);

  const list = useApi(() => api.alerts({ page, pageSize: PAGE_SIZE, ...range }), [page, range.from, range.to]);
  const freq = useApi(() => api.alertFrequency(range), [range.from, range.to]);
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

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
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : null}
        {list.data?.alerts.map((alert) => (
          <View key={alert.alertId} style={styles.alert}>
            <View style={styles.alertHead}>
              <Text style={styles.alertTitle}>{alert.headerText}</Text>
              <Badge text={humanizeEffect(alert.effectType)} />
            </View>
            <Muted>{alert.descriptionText}</Muted>
            <Text style={styles.meta}>
              {alert.affectedRoutes.join(", ") || "—"} · seen {formatTimestamp(alert.ingestedAtMs)}
            </Text>
          </View>
        ))}
        {list.data && list.data.alerts.length === 0 ? <Muted>No alerts in this period.</Muted> : null}

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
  alert: { gap: theme.spacing(1), paddingVertical: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  alertHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing(2) },
  alertTitle: { color: theme.colors.text, fontWeight: "700", fontSize: theme.fontSize.md, flex: 1 },
  meta: { color: theme.colors.textMuted, fontSize: theme.fontSize.xs },
  pageBtn: { backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: theme.radius },
  disabled: { opacity: 0.4 },
  pageText: { color: theme.colors.text, fontWeight: "600" },
  pageInfo: { color: theme.colors.textMuted, alignSelf: "center" },
});
