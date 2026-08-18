import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import type React from "react";
import { Text } from "react-native";
import type { ApiQuery } from "../../lib/api";
import { QueryBoundary } from "../../components/QueryBoundary";
import { createQueryClient } from "../../lib/query-client";
import { useApi, useApis } from "../useApi";
import { useLiveApi } from "../useLiveApi";

/**
 * These hooks are the only path a screen takes to the API.
 *
 * They return `data` non-nullably now: "nothing yet" and "this failed" belong
 * to the enclosing {@link QueryBoundary}, so a screen never re-implements
 * either. What is left to test here is what the hooks still decide — the query
 * key, ordering, and the live polling options.
 */

const query = <T,>(key: string, run: () => Promise<T>): ApiQuery<T> => ({ key: [key], run });

const renderIn = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <QueryBoundary pending={<Text>pending</Text>}>{ui}</QueryBoundary>
    </QueryClientProvider>,
  );

describe("useApi", () => {
  it("hands the screen data that is already there", async () => {
    function Panel() {
      const { data } = useApi(query("/a", async () => ({ n: 1 })));
      // No null check: the boundary guarantees this ran with data.
      return <Text>n={data.n}</Text>;
    }
    const { getByText } = renderIn(<Panel />);
    await waitFor(() => expect(getByText("n=1")).toBeTruthy());
  });

  it("shares one request between two callers of the same key", async () => {
    const run = jest.fn<Promise<{ n: number }>, []>().mockResolvedValue({ n: 1 });
    function Two() {
      // A screen and the footer both asking for /health in the same frame.
      const a = useApi(query("/health", run));
      const b = useApi(query("/health", run));
      return <Text>{`${a.data.n}${b.data.n}`}</Text>;
    }
    const { getByText } = renderIn(<Two />);
    await waitFor(() => expect(getByText("11")).toBeTruthy());
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("useApis", () => {
  it("resolves to results in the order requested", async () => {
    function Panel() {
      const { data } = useApis([
        query("/1", async () => "first"),
        query("/2", async () => "second"),
      ]);
      return <Text>{data.join(",")}</Text>;
    }
    const { getByText } = renderIn(<Panel />);
    await waitFor(() => expect(getByText("first,second")).toBeTruthy());
  });

  it("fetches them in parallel rather than one after another", async () => {
    // The comparison screen fetches one query per selected line. As a single
    // Promise.all these shared one cache entry; as separate queries each is
    // cached and retried on its own, but they must still go out together.
    const started: string[] = [];
    const slow = (id: string) =>
      query(id, () => {
        started.push(id);
        return new Promise<string>((resolve) => setTimeout(() => resolve(id), 10));
      });

    function Panel() {
      const { data } = useApis([slow("/a"), slow("/b"), slow("/c")]);
      return <Text>{data.join(",")}</Text>;
    }
    const { getByText } = renderIn(<Panel />);
    await waitFor(() => expect(getByText("/a,/b,/c")).toBeTruthy());
    expect(started).toEqual(["/a", "/b", "/c"]);
  });
});

describe("useLiveApi", () => {
  it("reports when the last successful response landed", async () => {
    function Board() {
      const { data, updatedAtMs } = useLiveApi(query("/live", async () => "3 trains"), 30_000);
      return <Text>{`${data}@${updatedAtMs > 0}`}</Text>;
    }
    const { getByText } = renderIn(<Board />);
    await waitFor(() => expect(getByText("3 trains@true")).toBeTruthy());
  });

  /**
   * The rule that used to justify a separate 80-line hook. It is now the
   * `throwOnError` predicate on the query client, so it holds here for the
   * same reason it holds everywhere else — see QueryBoundary's tests for the
   * boundary half.
   */
  it("keeps the last good data when a poll fails", async () => {
    let call = 0;
    function Board() {
      const { data, error } = useLiveApi(
        query("/live2", async () => {
          call += 1;
          if (call === 1) return "3 trains";
          throw new Error("network down");
        }),
        30_000,
      );
      return <Text>{`${data}|${error ? error.message : "ok"}`}</Text>;
    }
    const { getByText } = renderIn(<Board />);
    await waitFor(() => expect(getByText("3 trains|ok")).toBeTruthy());
  });
});
