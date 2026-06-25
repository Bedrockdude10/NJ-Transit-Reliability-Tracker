import { api } from "../../lib/api";
import { formatTimestamp } from "../../lib/format";
import { theme } from "../../lib/theme";
import { useApi } from "../../hooks/useApi";
import { Table } from "../../components/Table";
import { Card, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

export default function Health() {
  const { data, loading, error, reload } = useApi(() => api.health(), []);

  return (
    <Screen>
      <PageTitle title="Pipeline Health" subtitle="Transparency about data completeness" />
      {loading ? <Loading /> : null}
      {error ? <ErrorView message={error} onRetry={reload} /> : null}

      {data ? (
        <>
          <Row>
            <StatTile label="Collecting since" value={data.collectionStartDate ?? "—"} />
            <StatTile
              label="Uptime"
              value={`${data.uptimePercent}%`}
              color={data.uptimePercent >= 99 ? theme.colors.good : theme.colors.warn}
            />
            <StatTile label="Known gaps" value={String(data.knownGaps.length)} color={data.knownGaps.length ? theme.colors.warn : theme.colors.good} />
          </Row>

          <Card>
            <SectionTitle>Feeds</SectionTitle>
            <Table
              columns={[
                { key: "feed", label: "Feed", flex: 1.6 },
                { key: "last", label: "Last success", flex: 1.8 },
                { key: "polls", label: "Polls today", align: "right" },
                { key: "fails", label: "Fails today", align: "right" },
              ]}
              rows={data.feeds.map((f) => ({
                feed: f.feedType,
                last: formatTimestamp(f.lastSuccessAtMs),
                polls: f.pollsToday,
                fails: f.failuresToday,
              }))}
            />
          </Card>

          <Card>
            <SectionTitle>Known data gaps</SectionTitle>
            {data.knownGaps.length > 0 ? (
              <Table
                columns={[
                  { key: "feed", label: "Feed" },
                  { key: "from", label: "From", flex: 1.8 },
                  { key: "to", label: "To", flex: 1.8 },
                ]}
                rows={data.knownGaps.map((g) => ({ feed: g.feedType, from: formatTimestamp(g.startMs), to: formatTimestamp(g.endMs) }))}
              />
            ) : (
              <Muted>No collection gaps recorded.</Muted>
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
