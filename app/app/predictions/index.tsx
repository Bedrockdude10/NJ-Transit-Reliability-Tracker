import { useLocalSearchParams } from "expo-router";
import { api } from "../../lib/api";
import { formatDay, formatInt } from "../../lib/format";
import { accuracyNote, byLine, provenanceNote, signedSeconds } from "../../lib/predictions";
import { formatDelayShort } from "../../lib/format";
import { useApi } from "../../hooks/useApi";
import { QueryBoundary } from "../../components/QueryBoundary";
import { Table } from "../../components/Table";
import { Card, Muted, PageTitle, Row, Screen, SectionTitle, StatTile } from "../../components/ui";

/**
 * `/predictions` — what a model expects, and how wrong it has been.
 *
 * The only screen on the site showing numbers that were not observed. It is
 * arranged so that fact is unavoidable: the model and run are named, the headline
 * figure is the model's error rather than its forecast, and a date with no
 * predictions says so plainly instead of rendering an empty table.
 */
export default function Predictions() {
  // In the URL so a specific day, or one line, can be linked and returned to.
  const { date, line } = useLocalSearchParams<{ date?: string; line?: string }>();

  return (
    <Screen>
      <PageTitle
        title="Predicted delays"
        subtitle="Model output — how late a train is expected to be by the time it reaches a station"
      />
      <QueryBoundary>
        <PredictionPanel date={date} line={line} />
      </QueryBoundary>
    </Screen>
  );
}

function PredictionPanel({ date, line }: { date?: string; line?: string }) {
  const { data } = useApi(api.predictions(date, line));

  if (!data.available) {
    return (
      <Card title="No predictions yet">
        <Muted>
          Nothing has been predicted for {formatDay(data.serviceDate)}.
          {data.availableDates.length > 0
            ? ` Predictions exist for ${data.availableDates.map(formatDay).join(", ")}.`
            : " The delay model has not produced a run yet — this site shows no invented" +
              " numbers, so this panel stays empty until it does."}
        </Muted>
      </Card>
    );
  }

  const provenance = provenanceNote(data.provenance);

  return (
    <>
      <Card title={`Predictions for ${formatDay(data.serviceDate)}`} subtitle={provenance ?? undefined}>
        <Row>
          <StatTile
            label="Average miss"
            value={
              data.meanAbsoluteErrorSeconds === null
                ? "—"
                : formatDelayShort(data.meanAbsoluteErrorSeconds)
            }
            hint={`${data.scoredCount} trips scored`}
          />
          <StatTile
            label="Legs predicted"
            value={formatInt(data.totalPredictions)}
            hint={line ?? "all lines"}
          />
        </Row>
        <Muted>{accuracyNote(data)}</Muted>
        {data.totalPredictions > data.predictions.length ? (
          <Muted>
            Showing the {data.predictions.length} most delayed legs of{" "}
            {formatInt(data.totalPredictions)}.
          </Muted>
        ) : null}
      </Card>

      {byLine(data.predictions).map((group) => (
        <Card key={group.lineName}>
          <SectionTitle>{group.lineName}</SectionTitle>
          <Table
            columns={[
              { key: "leg", label: "Leg", flex: 3 },
              { key: "predicted", label: "Predicted", flex: 1.2 },
              { key: "actual", label: "Actual", flex: 1.2 },
              { key: "error", label: "Miss", flex: 1.2 },
            ]}
            rows={group.legs.map((leg) => ({
              key: `${leg.tripId}-${leg.toStopName}`,
              leg: `${leg.fromStopName} → ${leg.toStopName}`,
              predicted: formatDelayShort(leg.predictedDelaySeconds),
              actual: leg.actualDelaySeconds === null ? "—" : formatDelayShort(leg.actualDelaySeconds),
              error: signedSeconds(leg.errorSeconds),
            }))}
          />
          <Muted>
            A positive miss means the train was later than predicted. Blank actuals are trips that
            have not run yet.
          </Muted>
        </Card>
      ))}
    </>
  );
}
