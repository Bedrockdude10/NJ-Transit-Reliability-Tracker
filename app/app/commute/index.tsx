import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { formatDelayShort, formatInt, formatPercent } from "../../lib/format";
import { otpColor, theme } from "../../lib/theme";
import { parseWindowKey, windowDays, windowToRange } from "../../lib/windows";
import { useApi } from "../../hooks/useApi";
import { StationPicker } from "../../components/StationPicker";
import { Table } from "../../components/Table";
import { WindowPicker } from "../../components/WindowPicker";
import { Card, EmptyState, ErrorView, Loading, Muted, PageTitle, Row, SectionTitle, StatTile, Screen } from "../../components/ui";

export default function Commute() {
  // The selection lives in the URL, not in component state: a commute you
  // cannot bookmark or send to someone is not really "yours". This also makes
  // back/forward behave, and survives a reload.
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string; destination?: string; window?: string }>();
  const origin = params.origin ?? null;
  const destination = params.destination ?? null;
  const windowKey = parseWindowKey(params.window);
  const range = useMemo(() => windowToRange(windowDays(windowKey)), [windowKey]);

  const setParams = useCallback(
    (next: { origin?: string | null; destination?: string | null; window?: string }) => {
      router.setParams({
        origin: next.origin ?? origin ?? undefined,
        destination: next.destination ?? destination ?? undefined,
        window: next.window ?? windowKey,
      } as never);
    },
    [router, origin, destination, windowKey],
  );

  const setOrigin = (v: string) => setParams({ origin: v });
  const setDestination = (v: string) => setParams({ destination: v });
  const swap = () => setParams({ origin: destination, destination: origin });

  const stations = useApi(() => api.stations(), []);
  const ready = Boolean(origin && destination && origin !== destination);
  const commute = useApi(
    () => (ready ? api.commute(origin!, destination!, range) : Promise.resolve(null)),
    [origin, destination, ready, range.from, range.to],
  );
  const data = commute.data;

  return (
    <Screen>
      <PageTitle
        title="Your commute"
        subtitle="Reliability of one journey — the question the official figures don't answer"
      />

      <Card>
        <Row>
          <StationPicker
            label="From"
            stations={stations.data?.stations ?? []}
            value={origin}
            onChange={setOrigin}
            exclude={destination}
          />
          <StationPicker
            label="To"
            stations={stations.data?.stations ?? []}
            value={destination}
            onChange={setDestination}
            exclude={origin}
          />
        </Row>
        <Row>
          <WindowPicker value={windowKey} onChange={(k) => setParams({ window: k })} />
          {origin && destination ? (
            <Pressable onPress={swap} style={styles.swap}>
              <Text style={styles.swapText}>⇄ Reverse</Text>
            </Pressable>
          ) : null}
        </Row>
      </Card>

      {!ready ? (
        <Card>
          <EmptyState
            title="Pick two stations"
            hint="Choose where you start and where you finish. Reliability is a property of the journey, not of either station on its own — so the answer changes with direction."
          />
        </Card>
      ) : null}

      {ready && commute.loading ? <Loading /> : null}
      {ready && commute.error ? <ErrorView message={commute.error} onRetry={commute.reload} /> : null}

      {ready && data ? (
        data.observations === 0 ? (
          <Card>
            <EmptyState
              title="No trains observed"
              hint={`No train has been seen running ${data.origin.stopName} → ${data.destination.stopName} in this period. These stations may not share a direct service, or the journey may run the other way.`}
            />
          </Card>
        ) : (
          <>
            <Card>
              <SectionTitle>
                {data.origin.stopName} → {data.destination.stopName}
              </SectionTitle>
              <Row>
                <StatTile
                  label="On time (≤5 min)"
                  value={formatPercent(data.onTimePercent)}
                  color={data.onTimePercent !== null ? otpColor(data.onTimePercent) : undefined}
                  accent={data.onTimePercent !== null ? otpColor(data.onTimePercent) : undefined}
                  hint={`${formatInt(data.observations)} journeys`}
                />
                <StatTile label="Typical journey" value={data.medianJourneyMinutes !== null ? `${data.medianJourneyMinutes} min` : "—"} hint={data.scheduledJourneyMinutes !== null ? `${data.scheduledJourneyMinutes} min scheduled` : undefined} />
                <StatTile
                  label="Plan for (p90)"
                  value={formatDelayShort(data.p90ArrivalDelaySeconds)}
                  color={theme.colors.warn}
                  accent={theme.colors.warn}
                  hint="1 journey in 10 is worse"
                />
                <StatTile
                  label="Cancelled"
                  value={formatPercent(data.cancellationRatePercent)}
                  color={theme.colors.bad}
                  hint={`${formatInt(data.cancellations)} journeys`}
                />
              </Row>
              <Muted>Served by {data.linesServing.join(", ")}.</Muted>
            </Card>

            {data.mostReliable && data.leastReliable ? (
              <Row>
                <StatTile
                  label="Most reliable departure"
                  value={data.mostReliable.label}
                  color={theme.colors.good}
                  accent={theme.colors.good}
                  hint={`${formatPercent(data.mostReliable.onTimePercent)} on time`}
                />
                <StatTile
                  label="Least reliable departure"
                  value={data.leastReliable.label}
                  color={theme.colors.bad}
                  accent={theme.colors.bad}
                  hint={`${formatPercent(data.leastReliable.onTimePercent)} on time`}
                />
              </Row>
            ) : null}

            <Card>
              <SectionTitle>Every departure on this journey</SectionTitle>
              <Table
                columns={[
                  { key: "label", label: "Departs", flex: 1.1 },
                  { key: "line", label: "Line", flex: 1.8 },
                  { key: "n", label: "Runs", align: "right" },
                  { key: "otp", label: "On time", align: "right" },
                  { key: "p90", label: "p90", align: "right" },
                ]}
                rows={data.departures.map((d) => ({
                  label: d.label,
                  line: d.lineName,
                  n: d.observations,
                  // A percentage from a handful of runs is noise dressed as fact.
                  otp: d.lowSample ? "—" : formatPercent(d.onTimePercent),
                  p90: d.p90ArrivalDelaySeconds !== null ? formatDelayShort(d.p90ArrivalDelaySeconds) : "—",
                }))}
              />
              <Muted>
                Departures with fewer than 30 completed runs show “—” rather than a percentage: with this little data a
                rate says more about luck than about the train.
              </Muted>
            </Card>
          </>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  swap: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surfaceAlt,
  },
  swapText: { color: theme.colors.accent, fontSize: theme.fontSize.sm, fontWeight: "700" },
});
