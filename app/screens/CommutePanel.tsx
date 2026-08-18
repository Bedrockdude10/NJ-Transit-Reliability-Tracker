import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { api, type DateRange } from "../lib/api";
import { formatDelayShort, formatInt, formatPercent } from "../lib/format";
import { otpColor, theme } from "../lib/theme";

import { useWindow } from "../hooks/useWindow";
import { useApi } from "../hooks/useApi";
import { StationPicker } from "../components/StationPicker";
import { Table } from "../components/Table";
import { WindowPicker } from "../components/WindowPicker";
import { QueryBoundary } from "../components/QueryBoundary";
import { Card, EmptyState, Loading, Muted, PageTitle, Row, SectionTitle, StatTile } from "../components/ui";

export function CommutePanel() {
  // In the URL, not component state, so a commute is bookmarkable and survives reload.
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string; destination?: string; window?: string }>();
  const origin = params.origin ?? null;
  const destination = params.destination ?? null;
  const { key: windowKey, range, select: selectWindow } = useWindow();

  const setParams = useCallback(
    (next: { origin?: string | null; destination?: string | null }) => {
      router.setParams({
        origin: next.origin ?? origin ?? undefined,
        destination: next.destination ?? destination ?? undefined,
        window: windowKey,
      } as never);
    },
    [router, origin, destination, windowKey],
  );

  const setOrigin = (v: string) => setParams({ origin: v });
  const setDestination = (v: string) => setParams({ destination: v });
  const swap = () => setParams({ origin: destination, destination: origin });

  const ready = Boolean(origin && destination && origin !== destination);

  return (
    <>
      <PageTitle
        title="Your commute"
        subtitle="Reliability of one journey — the question the official figures don't answer"
      />

      <Card>
        <QueryBoundary pending={<Loading label="Loading stations…" />}>
          <StationChoosers origin={origin} destination={destination} onOrigin={setOrigin} onDestination={setDestination} />
        </QueryBoundary>
        <Row>
          <WindowPicker value={windowKey} onChange={selectWindow} />
          {origin && destination ? (
            <Pressable onPress={swap} style={styles.swap}>
              <Text style={styles.swapText}>⇄ Reverse</Text>
            </Pressable>
          ) : null}
        </Row>
      </Card>

      {/* The result component mounts only once both stations are chosen. A
          query that cannot run yet is not a disabled query — it is a component
          that should not be on screen, which is also why Suspense needs no
          special case for it. */}
      {ready ? (
        <QueryBoundary>
          <CommuteResult origin={origin!} destination={destination!} range={range} />
        </QueryBoundary>
      ) : (
        <Card>
          <EmptyState
            title="Pick two stations"
            hint="Choose where you start and where you finish. Reliability is a property of the journey, not of either station on its own — so the answer changes with direction."
          />
        </Card>
      )}
    </>
  );
}

function StationChoosers({
  origin,
  destination,
  onOrigin,
  onDestination,
}: {
  origin: string | null;
  destination: string | null;
  onOrigin: (v: string) => void;
  onDestination: (v: string) => void;
}) {
  const { data } = useApi(api.stations());
  return (
    <Row>
      <StationPicker label="From" stations={data.stations} value={origin} onChange={onOrigin} exclude={destination} />
      <StationPicker label="To" stations={data.stations} value={destination} onChange={onDestination} exclude={origin} />
    </Row>
  );
}

function CommuteResult({ origin, destination, range }: { origin: string; destination: string; range: Required<DateRange> }) {
  const { data } = useApi(api.commute(origin, destination, range));

  if (data.observations === 0) {
    return (
      <Card>
        <EmptyState
          title="No trains observed"
          hint={`No train has been seen running ${data.origin.stopName} → ${data.destination.stopName} in this period. These stations may not share a direct service, or the journey may run the other way.`}
        />
      </Card>
    );
  }

  return (
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
