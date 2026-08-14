import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { coverageNote, formatInt, formatPercent } from "../../lib/format";
import { otpColor } from "../../lib/theme";
import { useChartColors } from "../../lib/useChartColors";
import { windowToRange, type WindowKey } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { LineChart } from "../../components/charts/LineChart";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

export default function LightRail() {
  const [windowKey, setWindowKey] = useState<WindowKey>("1y");
  const [days, setDays] = useState(365);
  const range = useMemo(() => windowToRange(days), [days]);
  const c = useChartColors();

  const summary = useApi(api.lightRailSummary(range));

  return (
    <Screen>
      <PageTitle title="Light Rail" subtitle="Hudson-Bergen, Newark, and River Line — NJT's reported figures" />
      <WindowPicker
        value={windowKey}
        onChange={(key, d) => {
          setWindowKey(key);
          setDays(d);
        }}
      />

      {summary.loading ? <Loading /> : null}
      {summary.error ? <ErrorView message={summary.error} onRetry={summary.reload} /> : null}

      {summary.data ? (
        <>
          <Row>
            <StatTile
              label="On-time performance"
              value={formatPercent(summary.data.otpPercent)}
              color={summary.data.otpPercent !== null ? otpColor(summary.data.otpPercent) : undefined}
              hint={`NJT systemwide, ${summary.data.monthsCovered} mo`}
            />
          </Row>
          {coverageNote(summary.data.coverage) ? <Muted>{coverageNote(summary.data.coverage)}</Muted> : null}

          {summary.data.otpTrend.length > 1 ? (
            <Card>
              <SectionTitle>On-time performance over time</SectionTitle>
              <LineChart series={[{ label: "Light rail OTP", color: c.njt, values: summary.data.otpTrend.map((p) => p.otpPercent) }]} />
              <Muted>NJT's reported systemwide light-rail OTP, {summary.data.otpTrend.length} months.</Muted>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Mean distance between failures, by line</SectionTitle>
            <Table
              columns={[
                { key: "line", label: "Line", flex: 2.4 },
                { key: "mdbf", label: "Avg MDBF", align: "right", flex: 1.4 },
                { key: "months", label: "Months", align: "right" },
              ]}
              rows={summary.data.lines.map((l) => ({
                line: l.lineName,
                mdbf: `${formatInt(l.avgMdbf)} mi`,
                months: l.monthsCovered,
              }))}
            />
            <Muted>
              Light rail reliability is reported by NJT separately from commuter rail; per-train independent measurement isn’t
              collected here (it’s a different real-time feed).
            </Muted>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
