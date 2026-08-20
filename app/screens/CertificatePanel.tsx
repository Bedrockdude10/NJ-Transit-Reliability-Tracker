import type { CertificateBandResult } from "@njt/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { QueryBoundary } from "../components/QueryBoundary";
import { Table } from "../components/Table";
import {
  Badge,
  Card,
  EmptyState,
  Eyebrow,
  Muted,
  PageTitle,
  SectionTitle,
  SegmentedControl,
} from "../components/ui";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { formatDay, formatDelayShort, formatInt, formatPercent, formatShortDate } from "../lib/format";
import { theme } from "../lib/theme";

/**
 * A dated record of how late a line ran, for a rider who has to explain it to
 * someone else. After JR East's 遅延証明書.
 */
export function CertificatePanel() {
  const router = useRouter();
  const { certLine, certDate } = useLocalSearchParams<{ certLine?: string; certDate?: string }>();
  // In the URL, not state: a certificate names a line and a date, and the point
  // of one is that a rider can send it to somebody.
  const setLine = useCallback(
    (value: string) => router.setParams({ certLine: value } as never),
    [router],
  );
  const setDate = useCallback(
    (value: string) => router.setParams({ certDate: value } as never),
    [router],
  );

  return (
    <>
      <PageTitle
        title="Delay certificate"
        subtitle="An independent record of how late a line ran, by time of day"
      />
      <QueryBoundary>
        <Certificate line={certLine} date={certDate} onLine={setLine} onDate={setDate} />
      </QueryBoundary>
    </>
  );
}

const COLUMNS = [
  { key: "band", label: "Time of day", flex: 2 },
  { key: "trains", label: "Trains", align: "right" as const },
  { key: "late", label: "5+ min late", align: "right" as const },
  { key: "avg", label: "Average", align: "right" as const },
  { key: "worst", label: "Worst", align: "right" as const },
];

function bandRow(band: CertificateBandResult) {
  if (band.trainsObserved === 0) {
    return { band: band.label, trains: "0", late: "—", avg: "—", worst: "—" };
  }
  return {
    band: band.issued ? `${band.label} ✓` : band.label,
    trains: formatInt(band.trainsObserved),
    late: `${formatPercent(band.latePercent)} (${band.trainsLate})`,
    avg: formatDelayShort(band.avgDelaySeconds),
    worst: formatDelayShort(band.maxDelaySeconds),
  };
}

function statement(
  lineName: string,
  serviceDate: string,
  thresholdSeconds: number,
  issuedBands: readonly CertificateBandResult[],
): string {
  const day = formatDay(serviceDate);
  if (issuedBands.length === 0) {
    return (
      `Trains on the ${lineName} averaged less than ${formatDelayShort(thresholdSeconds)} ` +
      `behind schedule in every time band on ${day}.`
    );
  }
  const worst = issuedBands.reduce((a, b) => (b.avgDelaySeconds > a.avgDelaySeconds ? b : a));
  const bands = issuedBands.map((b) => b.label.toLowerCase()).join(", ");
  return (
    `Trains on the ${lineName} ran behind schedule during ${bands} on ${day}, ` +
    `averaging ${formatDelayShort(worst.avgDelaySeconds)} late at worst.`
  );
}

function Certificate({
  line,
  date,
  onLine,
  onDate,
}: {
  line: string | undefined;
  date: string | undefined;
  onLine: (value: string) => void;
  onDate: (value: string) => void;
}) {
  const { data } = useApi(api.certificate(line, date));

  if (data.lineName === "") {
    return (
      <EmptyState
        title="Nothing measured yet"
        hint="A certificate is issued from observed arrivals, and none have been recorded."
      />
    );
  }

  const issuedBands = data.bands.filter((b) => b.issued);
  const thin = issuedBands.some((b) => b.lowSample);

  return (
    <>
      <Eyebrow>Line</Eyebrow>
      <SegmentedControl
        options={data.lines.map((name) => ({ key: name, label: name }))}
        value={data.lineName}
        onChange={onLine}
      />
      <Eyebrow>Date</Eyebrow>
      <SegmentedControl
        options={data.availableDates
          .slice(-7)
          .reverse()
          .map((d) => ({ key: d, label: formatShortDate(d) }))}
        value={data.serviceDate}
        onChange={onDate}
      />

      <Card>
        <View style={styles.header}>
          <SectionTitle>
            {data.lineName} — {formatDay(data.serviceDate)}
          </SectionTitle>
          <Badge
            text={data.issued ? "Delay certified" : "No delay to certify"}
            color={data.issued ? theme.colors.warn : theme.colors.textMuted}
            tint={data.issued ? theme.colors.warnSoft : theme.colors.surfaceAlt}
          />
        </View>

        <Text style={styles.statement}>
          {statement(data.lineName, data.serviceDate, data.thresholdSeconds, issuedBands)}
        </Text>

        <Table columns={COLUMNS} rows={data.bands.map(bandRow)} />

        <Muted>
          A band is certified when its average arrival is {formatDelayShort(data.thresholdSeconds)} or more
          behind schedule. Measured independently from NJ Transit's public real-time feed, not from NJT's own
          punctuality reporting.
          {thin ? " Some certified bands ran few trains, so treat them as preliminary." : ""}
        </Muted>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  statement: {
    color: theme.colors.text,
    fontSize: theme.fontSize.md,
    lineHeight: 22,
    marginVertical: theme.spacing(2),
  },
});
