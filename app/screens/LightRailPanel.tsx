
import { api, type DateRange } from "../lib/api";
import { officialPeriodLabel, formatInt, formatPercent } from "../lib/format";
import { otpColor } from "../lib/theme";
import { useChartColors } from "../lib/useChartColors";
import { useWindow } from "../hooks/useWindow";
import { useApi } from "../hooks/useApi";
import { LineChart } from "../components/charts/LineChart";
import { Table } from "../components/Table";
import { WindowPicker } from "../components/WindowPicker";
import { QueryBoundary } from "../components/QueryBoundary";
import { Card, Muted, PageTitle, Row, SectionTitle, StatTile } from "../components/ui";

export function LightRailPanel() {
  const { key: windowKey, range, select: selectWindow } = useWindow("1y");

  return (
    <>
      <PageTitle title="Light Rail" subtitle="Hudson-Bergen, Newark, and River Line — NJT's reported figures" />
      <WindowPicker value={windowKey} onChange={selectWindow} />
      <QueryBoundary>
        <LightRailSummary range={range} />
      </QueryBoundary>
    </>
  );
}

function LightRailSummary({ range }: { range: Required<DateRange> }) {
  const c = useChartColors();
  const { data } = useApi(api.lightRailSummary(range));

  return (
    <>
      <Card
        title="NJ Transit's own published figures"
        subtitle={officialPeriodLabel(data.coverage) ?? "Not yet published for any month"}
      >
        <Row>
          <StatTile
            label="On-time performance"
            value={formatPercent(data.otpPercent)}
            color={data.otpPercent !== null ? otpColor(data.otpPercent) : undefined}
            hint={`NJT systemwide, ${data.monthsCovered} mo`}
          />
        </Row>
      </Card>

      {data.otpTrend.length > 1 ? (
        <Card>
          <SectionTitle>On-time performance over time</SectionTitle>
          <LineChart series={[{ label: "Light rail OTP", color: c.njt, values: data.otpTrend.map((p) => p.otpPercent) }]} />
          <Muted>NJT's reported systemwide light-rail OTP, {data.otpTrend.length} months.</Muted>
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
          rows={data.lines.map((l) => ({
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
  );
}
