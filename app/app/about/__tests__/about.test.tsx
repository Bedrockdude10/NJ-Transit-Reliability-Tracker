import { render } from "@testing-library/react-native";
import About from "../index";

describe("About / Methodology page", () => {
  it("renders the key sections without hitting the API", () => {
    const { getByText } = render(<About />);
    expect(getByText("On-time performance (OTP)")).toBeTruthy();
    expect(getByText("Data sources")).toBeTruthy();
    expect(getByText("Real vs. modeled — read this")).toBeTruthy();
  });
});
