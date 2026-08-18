import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { TabbedPage } from "../TabbedPage";

/**
 * The nav went from twelve buttons to five, which only works if the panels
 * grouped behind one button stay reachable, linkable, and cheap. These pin the
 * three properties that make that true.
 */

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockParams: { tab?: string } = {};
const mockSetParams = jest.fn((next: { tab?: string }) => Object.assign(mockParams, next));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams }),
}));

const rendered: string[] = [];
const panel = (name: string) => () => {
  rendered.push(name);
  return <Text>{name} body</Text>;
};

const tabs = () => [
  { key: "map", label: "Map", render: panel("map") },
  { key: "lines", label: "Lines", render: panel("lines") },
] as const;

beforeEach(() => {
  delete mockParams.tab;
  rendered.length = 0;
  mockSetParams.mockClear();
});

describe("TabbedPage", () => {
  it("opens on the first tab when the URL names none", () => {
    const { getByText } = render(<TabbedPage tabs={tabs()} />);
    expect(getByText("map body")).toBeTruthy();
  });

  it("opens on the tab the URL names, so a shared link lands where it was sent", () => {
    mockParams.tab = "lines";
    const { getByText } = render(<TabbedPage tabs={tabs()} />);
    expect(getByText("lines body")).toBeTruthy();
  });

  it("falls back rather than rendering an empty frame for an unknown tab", () => {
    mockParams.tab = "nonsense";
    const { getByText } = render(<TabbedPage tabs={tabs()} />);
    expect(getByText("map body")).toBeTruthy();
  });

  it("renders only the selected panel, so an unopened tab costs no queries", () => {
    render(<TabbedPage tabs={tabs()} />);
    expect(rendered).toEqual(["map"]);
  });
});
