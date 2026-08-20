import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { CertificatePanel } from "../CertificatePanel";
import { createQueryClient } from "../../lib/query-client";

/**
 * The certificate is the one screen a rider shows to somebody else, so its
 * wording is the feature. It has to state plainly what was measured and refuse
 * to certify a day that was fine — a document that always says "delayed" is
 * worth nothing to the person reading it.
 */

const mockSetParams = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: mockSetParams }),
}));

const respondWith = (body: unknown) =>
  jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);

const renderScreen = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CertificatePanel />
    </QueryClientProvider>,
  );

function band(overrides: Record<string, unknown> = {}) {
  return {
    band: "am_peak",
    label: "Morning peak",
    startHour: 6,
    endHour: 10,
    trainsObserved: 40,
    trainsLate: 22,
    latePercent: 55,
    avgDelaySeconds: 600,
    maxDelaySeconds: 1800,
    issued: true,
    lowSample: false,
    ...overrides,
  };
}

const QUIET = {
  lineName: "Northeast Corridor Line",
  serviceDate: "2026-08-18",
  thresholdSeconds: 300,
  bands: [band({ trainsLate: 2, latePercent: 5, avgDelaySeconds: 90, issued: false })],
  issued: false,
  worstBand: null,
  availableDates: ["2026-08-18"],
  lines: ["Northeast Corridor Line"],
};

const DELAYED = {
  ...QUIET,
  bands: [band()],
  issued: true,
  worstBand: "am_peak",
};

const EMPTY = { ...QUIET, lineName: "", bands: [], availableDates: [], lines: [] };

afterEach(() => {
  jest.restoreAllMocks();
  mockSetParams.mockClear();
});

describe("the delay certificate", () => {
  it("certifies a delayed band and names when it happened", async () => {
    respondWith(DELAYED);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Delay certified")).toBeTruthy());
    expect(screen.getByText(/ran behind schedule during morning peak/iu)).toBeTruthy();
  });

  it("refuses to certify a day that ran acceptably", async () => {
    respondWith(QUIET);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("No delay to certify")).toBeTruthy());
  });

  it("states the threshold it applied, so the reader can check the claim", async () => {
    respondWith(DELAYED);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/average arrival is/iu)).toBeTruthy());
  });

  it("says the measurement is independent of NJT's own reporting", async () => {
    respondWith(DELAYED);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/independently/iu)).toBeTruthy());
  });

  it("warns when a certified band rests on few trains", async () => {
    respondWith({ ...DELAYED, bands: [band({ lowSample: true, trainsObserved: 4 })] });
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText(/preliminary/iu)).toBeTruthy());
  });

  it("does not warn when the sample is adequate", async () => {
    respondWith(DELAYED);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Delay certified")).toBeTruthy());
    expect(screen.queryByText(/preliminary/iu)).toBeNull();
  });

  it("puts the chosen date in the URL, so the certificate can be sent to somebody", async () => {
    respondWith({ ...DELAYED, availableDates: ["2026-08-17", "2026-08-18"] });
    const screen = renderScreen();
    const other = await waitFor(() => screen.getByText("Aug 17"));
    fireEvent.press(other);
    expect(mockSetParams).toHaveBeenCalledWith({ certDate: "2026-08-17" });
  });

  it("reads as a deliberate absence when nothing has been measured", async () => {
    respondWith(EMPTY);
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText("Nothing measured yet")).toBeTruthy());
  });
});
