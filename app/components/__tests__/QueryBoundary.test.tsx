import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { QueryBoundary } from "../QueryBoundary";
import { createQueryClient } from "../../lib/query-client";

/**
 * The contract three dozen hand-written loading/error ladders used to encode,
 * inconsistently, now stated once. `createQueryClient` is used rather than a
 * bare client because the behaviour under test lives in its `throwOnError`
 * default — testing a hand-built client would prove nothing about the app.
 */

function Panel({ run }: { run: () => Promise<string> }) {
  const { data, error, refetch } = useSuspenseQuery({ queryKey: ["panel"], queryFn: run, retry: false });
  (globalThis as { __refetch?: () => Promise<unknown> }).__refetch = refetch;
  return (
    <>
      <Text>data:{data}</Text>
      <Text>err:{error ? (error as Error).message : "none"}</Text>
    </>
  );
}

const renderPanel = (run: () => Promise<string>) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <QueryBoundary pending={<Text>pending</Text>}>
        <Panel run={run} />
      </QueryBoundary>
    </QueryClientProvider>,
  );

describe("QueryBoundary", () => {
  it("shows the pending fallback until the data arrives", async () => {
    const { getByText } = renderPanel(async () => "3 trains");
    expect(getByText("pending")).toBeTruthy();
    await waitFor(() => expect(getByText("data:3 trains")).toBeTruthy());
  });

  it("sends a first load that fails to the error boundary", async () => {
    // Nothing to keep on screen, so this one belongs to the boundary.
    const { getByText } = renderPanel(() => Promise.reject(new Error("API 500 for /x")));
    await waitFor(() => expect(getByText("Couldn’t load data")).toBeTruthy());
    expect(getByText("API 500 for /x")).toBeTruthy();
  });

  it("offers a retry that can actually succeed", async () => {
    // Without QueryErrorResetBoundary the retry re-renders the same failed
    // query straight back into the fallback, and the button does nothing.
    let attempt = 0;
    const { getByText, queryByText } = renderPanel(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return "recovered";
    });

    await waitFor(() => expect(getByText("Retry")).toBeTruthy());
    // biome-ignore lint/nursery/useAwaitThenable: React's act is a void|Thenable union; the async callback makes it a thenable, so the await flushes the retry.
    await act(async () => { fireEvent.press(getByText("Retry")); });
    await waitFor(() => expect(queryByText("data:recovered")).toBeTruthy());
  });

  /** The rule the live departure board depends on. */
  it("keeps the last good data when a refresh fails, and never blanks the screen", async () => {
    let call = 0;
    const { getByText, queryByText } = renderPanel(async () => {
      call += 1;
      if (call === 1) return "3 trains";
      throw new Error("network down");
    });

    await waitFor(() => expect(getByText("data:3 trains")).toBeTruthy());
    // biome-ignore lint/nursery/useAwaitThenable: React's act is a void|Thenable union; the async callback makes it a thenable, so the await flushes the refetch.
    await act(async () => {
      await (globalThis as { __refetch?: () => Promise<unknown> }).__refetch?.();
    });

    await waitFor(() => expect(getByText("err:network down")).toBeTruthy());
    // The failure is reported beside the data, not instead of it.
    expect(getByText("data:3 trains")).toBeTruthy();
    expect(queryByText("Couldn’t load data")).toBeNull();
  });
});
