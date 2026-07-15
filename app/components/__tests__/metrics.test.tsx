import type { DistributionBucketResult, OtpThresholdResult } from "@njt/shared";
import { render } from "@testing-library/react-native";
import { DelayHistogram, GapCallout, OtpComparison } from "../metrics";

const thresholds: OtpThresholdResult[] = [
  { thresholdSeconds: 300, thresholdMinutes: 5, otpPercent: 62, onTimeTrips: 620 },
  { thresholdSeconds: 900, thresholdMinutes: 15, otpPercent: 88, onTimeTrips: 880 },
];

describe("GapCallout", () => {
  it("shows the strict and official percentages", () => {
    const { getByText } = render(<GapCallout strictPercent={60} njtPercent={85} />);
    expect(getByText("60%")).toBeTruthy();
    expect(getByText("85%")).toBeTruthy();
    expect(getByText("25-point")).toBeTruthy();
  });

  it("renders nothing without an official figure", () => {
    const { queryByText } = render(<GapCallout strictPercent={60} njtPercent={null} />);
    expect(queryByText(/point/)).toBeNull();
  });

  it("renders nothing when the period has no measured data", () => {
    const { queryByText } = render(<GapCallout strictPercent={0} njtPercent={85} measured={false} />);
    expect(queryByText(/point/)).toBeNull();
  });
});

describe("OtpComparison", () => {
  it("renders the comparison chart when measured", () => {
    const { getByText, queryByText } = render(<OtpComparison thresholds={thresholds} njtOfficial={null} measured />);
    expect(getByText(/Each bar is the on-time rate/)).toBeTruthy();
    expect(queryByText("No data yet")).toBeNull();
  });

  it("shows a No data yet state when there are no measured trips", () => {
    const { getByText, queryByText } = render(<OtpComparison thresholds={thresholds} njtOfficial={null} measured={false} />);
    expect(getByText("No data yet")).toBeTruthy();
    expect(queryByText(/Each bar is the on-time rate/)).toBeNull();
  });
});

describe("DelayHistogram", () => {
  const populated: DistributionBucketResult[] = [
    { label: "0-5 min", count: 40 },
    { label: "5-10 min", count: 12 },
  ];
  const empty: DistributionBucketResult[] = [
    { label: "0-5 min", count: 0 },
    { label: "5-10 min", count: 0 },
  ];

  it("renders the histogram when there are observed trips", () => {
    const { getByText, queryByText } = render(<DelayHistogram distribution={populated} />);
    expect(getByText(/Trips by terminal delay/)).toBeTruthy();
    expect(queryByText("No data yet")).toBeNull();
  });

  it("shows a No data yet state when every bucket is empty", () => {
    const { getByText, queryByText } = render(<DelayHistogram distribution={empty} />);
    expect(getByText("No data yet")).toBeTruthy();
    expect(queryByText(/Trips by terminal delay/)).toBeNull();
  });
});
