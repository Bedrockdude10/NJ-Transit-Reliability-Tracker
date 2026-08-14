import { renderHook, act } from "@testing-library/react-native";
import { useWindow } from "../useWindow";
import { windowToRange, windowDays } from "../../lib/windows";

/**
 * The window used to be two `useState`s per screen — `windowKey` and `days` —
 * kept in step by hand, in seven screens, six of which lost the choice on
 * navigation because it never reached the URL. These pin the properties that
 * arrangement could not offer.
 */

// `mock`-prefixed so jest's factory hoisting allows the reference.
const mockParams: { window?: string } = {};
const mockSetParams = jest.fn((next: { window?: string }) => Object.assign(mockParams, next));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams }),
}));

beforeEach(() => {
  delete mockParams.window;
  mockSetParams.mockClear();
});

describe("useWindow", () => {
  it("opens at the screen's default when the URL says nothing", () => {
    const { result } = renderHook(() => useWindow("90d"));
    expect(result.current.key).toBe("90d");
  });

  it("lets the URL override the default, so a shared link opens as sent", () => {
    mockParams.window = "7d";
    const { result } = renderHook(() => useWindow("90d"));
    expect(result.current.key).toBe("7d");
  });

  it("writes the choice to the URL rather than to component state", () => {
    // This is what makes the window survive navigation and be shareable —
    // six screens previously kept it in useState and silently lost it.
    const { result } = renderHook(() => useWindow());
    act(() => result.current.select("1y"));
    expect(mockSetParams).toHaveBeenCalledWith({ window: "1y" });
  });

  it("derives the range from the key instead of storing it alongside", () => {
    mockParams.window = "7d";
    const { result } = renderHook(() => useWindow());
    // `days` was a second source of truth for something `key` already decides.
    expect(result.current.range).toEqual(windowToRange(windowDays("7d")));
  });

  it("falls back rather than trusting an unrecognised window from a URL", () => {
    mockParams.window = "; DROP TABLE";
    const { result } = renderHook(() => useWindow("30d"));
    expect(result.current.key).toBe("30d");
  });
});
