import { render } from "@testing-library/react-native";
import { LiveBadge, LiveBanner } from "../Indicators";

describe("LiveBadge", () => {
  it("reads LIVE once collection has started", () => {
    const { getByText } = render(<LiveBadge collectionStartDate="2025-07-15" />);
    expect(getByText(/LIVE/u)).toBeTruthy();
  });

  it("reads NO DATA YET before any data accrues", () => {
    const { getByText } = render(<LiveBadge collectionStartDate={null} />);
    expect(getByText(/NO DATA YET/u)).toBeTruthy();
  });
});

describe("LiveBanner", () => {
  it("states the measuring-since date when live", () => {
    const { getByText } = render(<LiveBanner collectionStartDate="2025-07-15" />);
    expect(getByText(/Live · measuring since Jul 15, 2025/u)).toBeTruthy();
  });

  it("says measurement hasn't started when there is no date", () => {
    const { getByText } = render(<LiveBanner collectionStartDate={null} />);
    expect(getByText(/hasn’t started yet/u)).toBeTruthy();
  });
});
