import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { TrainRecordPanel } from "../TrainRecordPanel";
import { createQueryClient } from "../../lib/query-client";

/**
 * The record answers "is *my* train the problem", so the numbers that matter are
 * the ones a rider can act on: how often it is late, and how late to plan for. A
 * cancellation must not read as an on-time run.
 */

const mockSetParams = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: mockSetParams }),
}));

/** 2026-08-17T12:42Z, which is 8:42 AM at a New Jersey station. */
const SCHEDULED = 1_786_020_120;

const STATIONS = {
  stations: [
    { stopId: "NWK", stopName: "Newark Penn", lines: ["Northeast Corridor Line"] },
    { stopId: "NYP", stopName: "New York Penn", lines: ["Northeast Corridor Line"] },
  ],
};

const RANKINGS = {
  from: "2026-05-21",
  to: "2026-08-19",
  sort: "delay",
  excludedLowSample: 0,
  stations: [
    {
      stopId: "NYP",
      stopName: "New York Penn",
      lines: ["Northeast Corridor Line"],
      avgArrivalDelaySeconds: 400,
      observations: 900,
      amplificationRatePercent: 12.5,
      arrivedWithin5Min: 600,
      lowSample: false,
    },
  ],
};

const TOP_TRIPS = {
  scopeLabel: "New York Penn",
  from: "2026-05-21",
  to: "2026-08-19",
  trips: [
    {
      tripId: "3928",
      routeId: "NE",
      lineName: "Northeast Corridor Line",
      direction: "inbound",
      terminalStopName: "New York Penn",
      scheduledDepartureSeconds: SCHEDULED,
      avgTerminalDelaySeconds: 720,
      observations: 26,
    },
  ],
};

const RECORD = {
  tripId: "3928",
  lineName: "Northeast Corridor Line",
  direction: "inbound",
  originStopName: "Trenton",
  terminalStopName: "New York Penn",
  measuredAtStopId: "NYP",
  measuredAtStopName: "New York Penn",
  from: "2026-05-21",
  to: "2026-08-19",
  runs: 26,
  cancellations: 2,
  latePercent: 61.5,
  onTime: [
    { thresholdSeconds: 300, onTimePercent: 38.5 },
    { thresholdSeconds: 600, onTimePercent: 70 },
  ],
  medianDelaySeconds: 420,
  p90DelaySeconds: 1500,
  recentRuns: [
    { serviceDate: "2026-08-17", delaySeconds: 120, cancelled: false },
    { serviceDate: "2026-08-18", delaySeconds: null, cancelled: true },
    { serviceDate: "2026-08-19", delaySeconds: 900, cancelled: false },
  ],
  lowSample: false,
};

/** Routes by path, because the panel fans out to rankings, then trips, then the record. */
function respondByPath(record: unknown = RECORD) {
  return jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes("/record")
      ? record
      : url.includes("top-delayed-trips")
        ? TOP_TRIPS
        : url.includes("/rankings")
          ? RANKINGS
          : STATIONS;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

const renderScreen = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TrainRecordPanel />
    </QueryClientProvider>,
  );

/** Render, wait for the choices, and pick the one departure the fixture offers. */
async function selectDeparture() {
  const screen = renderScreen();
  const choice = await waitFor(() => screen.getByText(/8:42 AM/u));
  fireEvent.press(choice);
  await waitFor(() => expect(screen.getByText("Recent runs")).toBeTruthy());
  return screen;
}

afterEach(() => {
  jest.restoreAllMocks();
  mockSetParams.mockClear();
});

describe("one departure's record", () => {
  it("asks the rider to pick a departure before showing numbers", async () => {
    respondByPath();
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/select a departure/iu)).toBeTruthy());
  });

  it("names a departure by its scheduled time and where it goes", async () => {
    // The internal GTFS trip id was the whole label once. No rider has seen one.
    respondByPath();
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/8:42 AM · to New York Penn/u)).toBeTruthy());
  });

  it("does not label a departure by its internal trip id", async () => {
    respondByPath();
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/8:42 AM/u)).toBeTruthy());
    expect(screen.queryByText(/· 3928 ·/u)).toBeNull();
  });

  it("says when a departure has no timetable time rather than printing a dash alone", async () => {
    const noTime = { ...TOP_TRIPS, trips: [{ ...TOP_TRIPS.trips[0], scheduledDepartureSeconds: null }] };
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes("/record")
        ? RECORD
        : url.includes("top-delayed-trips")
          ? noTime
          : url.includes("/rankings")
            ? RANKINGS
            : STATIONS;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/Unscheduled · to New York Penn/u)).toBeTruthy());
  });

  it("lets the rider choose which station the departures are from", async () => {
    // Without this the page pinned itself to the single worst station, so every
    // row on it was the same branch.
    respondByPath();
    const screen = renderScreen();
    fireEvent.press(await waitFor(() => screen.getByText("\u25bc")));
    fireEvent.press(await waitFor(() => screen.getByText("Newark Penn")));
    expect(mockSetParams).toHaveBeenCalledWith(expect.objectContaining({ recordStop: "NWK" }));
  });

  it("leads with how often the train is late and how late to plan for", async () => {
    respondByPath();
    const screen = await selectDeparture();
    expect(screen.getByText("Late over 5 min")).toBeTruthy();
    expect(screen.getByText("61.5%")).toBeTruthy();
    expect(screen.getByText("Plan around")).toBeTruthy();
  });

  it("says a cancelled run was cancelled, rather than showing it as punctual", async () => {
    respondByPath();
    const screen = await selectDeparture();
    // A blank or a zero here would read as an on-time run, which is the opposite.
    expect(screen.getByText("cancelled")).toBeTruthy();
  });

  it("names where lateness was measured, so the number is not ambiguous", async () => {
    respondByPath();
    const screen = await selectDeparture();
    expect(screen.getByText(/measured on arrival at New York Penn/u)).toBeTruthy();
  });

  it("flags a thin record as preliminary instead of quoting it flatly", async () => {
    respondByPath({ ...RECORD, runs: 3, lowSample: true });
    const screen = await selectDeparture();
    expect(screen.getByText("Preliminary")).toBeTruthy();
  });
});
