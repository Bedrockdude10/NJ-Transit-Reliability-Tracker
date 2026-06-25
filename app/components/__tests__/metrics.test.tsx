import { render } from "@testing-library/react-native";
import { GapCallout } from "../metrics";

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
});
