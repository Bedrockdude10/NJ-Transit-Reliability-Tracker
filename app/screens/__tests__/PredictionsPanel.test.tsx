import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import { PredictionsPanel } from "../PredictionsPanel";
import { createQueryClient } from "../../lib/query-client";

/**
 * The predictions screen shows the only numbers on this site that were not
 * observed, and for now it shows none at all: no model has run.
 *
 * Both states are worth holding. The empty one has to read as a deliberate
 * absence rather than a broken panel — this project publishes no invented data,
 * so "nothing here yet" is the honest answer and has to look like one. The
 * populated one has to lead with the model's error, not its forecast.
 */

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));

const respondWith = (body: unknown) =>
  jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);

const renderScreen = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PredictionsPanel />
    </QueryClientProvider>,
  );

const EMPTY = {
  serviceDate: "2026-08-15",
  available: false,
  availableDates: [],
  provenance: null,
  predictions: [],
  meanAbsoluteErrorSeconds: null,
  scoredCount: 0,
  lines: [],
  totalPredictions: 0,
};

const POPULATED = {
  ...EMPTY,
  available: true,
  availableDates: ["2026-08-14"],
  serviceDate: "2026-08-14",
  provenance: { modelVersion: "lgbm-0.1.0", runId: "abc123def", predictedAtEpochSeconds: 1_786_500_000 },
  predictions: [
    {
      tripId: "T1",
      lineName: "Northeast Corridor",
      fromStopName: "Newark Penn Station",
      toStopName: "New York Penn Station",
      horizonSeconds: 1800,
      scheduledArrivalTime: "07:15:00",
      predictedDelaySeconds: 240,
      interval: null,
      actualDelaySeconds: 300,
      errorSeconds: 60,
    },
  ],
  meanAbsoluteErrorSeconds: 60,
  scoredCount: 1,
  lines: ["Northeast Corridor"],
  totalPredictions: 1,
};

afterEach(() => jest.restoreAllMocks());

describe("Predictions screen", () => {
  it("says nothing has been predicted, and why, rather than showing an empty table", async () => {
    respondWith(EMPTY);
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("No predictions yet")).toBeTruthy());
    expect(getByText(/no invented\s+numbers/u)).toBeTruthy();
  });

  it("names the model and run alongside the numbers", async () => {
    // A forecast with no provenance invites more confidence than it has earned.
    respondWith(POPULATED);
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("Model lgbm-0.1.0, run abc123de")).toBeTruthy());
  });

  it("leads with the rider's train, not with how the model has scored", async () => {
    // A rider opens this to find one train. The model's track record is real and
    // stays on the page, but below the thing they came for.
    respondWith(POPULATED);
    const { getByText, getAllByText } = renderScreen();

    await waitFor(() => expect(getByText("Northeast Corridor")).toBeTruthy());

    const trainFirst = getAllByText(/Northeast Corridor|Average miss/u).map((node) =>
      String(node.props.children),
    );
    expect(trainFirst[0]).toBe("Northeast Corridor");
  });

  it("says which service date it is showing", async () => {
    respondWith(POPULATED);
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText(/Predictions for/u)).toBeTruthy());
  });

  it("still reports the model's average miss, further down", async () => {
    respondWith(POPULATED);
    const { getByText } = renderScreen();

    await waitFor(() =>
      expect(getByText("Off by 1m on average, across 1 trip that has run.")).toBeTruthy(),
    );
    expect(getByText("Average miss")).toBeTruthy();
  });

  it("shows the leg, and the miss with its sign", async () => {
    respondWith(POPULATED);
    const { getByText } = renderScreen();

    await waitFor(() =>
      expect(getByText("Newark Penn Station → New York Penn Station")).toBeTruthy(),
    );
    expect(getByText("+1m")).toBeTruthy();
  });

  it("shows the point estimate on a day the model published no range", async () => {
    // The normal case, and it stays normal: intervals are optional, so a
    // point-only run must render exactly as it did before they existed.
    respondWith(POPULATED);
    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText("4m")).toBeTruthy());
    expect(getByText("Predicted")).toBeTruthy();
    expect(queryByText(/prediction intervals/u)).toBeNull();
  });

  it("shows the range, and what its confidence means, when the model published one", async () => {
    // "5m–12m" is the claim the model can support; "8m 24s" is not.
    respondWith({
      ...POPULATED,
      predictions: [
        {
          ...POPULATED.predictions[0],
          interval: { lowerSeconds: 300, upperSeconds: 720, percent: 80 },
        },
      ],
    });
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText("5m–12m")).toBeTruthy());
    expect(getByText("Predicted range")).toBeTruthy();
    expect(getByText(/80% prediction intervals/u)).toBeTruthy();
  });
});
