import { render } from "@testing-library/react-native";
import { AboutPanel } from "../AboutPanel";

describe("AboutPanel (methodology)", () => {
  it("renders the key sections without hitting the API", () => {
    const { getByText } = render(<AboutPanel />);
    expect(getByText("On-time performance (OTP)")).toBeTruthy();
    expect(getByText("Data sources")).toBeTruthy();
    expect(getByText("Official vs. independently measured — read this")).toBeTruthy();
  });
});
