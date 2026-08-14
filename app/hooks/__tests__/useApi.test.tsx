import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import type { ApiQuery } from "../../lib/api";
import { useApi, useApis } from "../useApi";
import { useLiveApi } from "../useLiveApi";

/**
 * These hooks are the only path any screen takes to the API, so the behaviours
 * below are the ones every screen depends on. They were previously hand-written
 * effects; they are now configuration, and configuration is exactly the kind of
 * thing that is easy to get subtly wrong and never notice.
 */

const clients: QueryClient[] = [];

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    // `gcTime: 0` so the cache holds no timer after a test finishes — otherwise
    // the default five-minute collection timer keeps the Jest process alive.
    defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 0 } },
  });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  for (const c of clients) c.clear();
  clients.length = 0;
});

const query = <T,>(key: string, run: () => Promise<T>): ApiQuery<T> => ({ key: [key], run });

describe("useApi", () => {
  it("reports data once it arrives", async () => {
    const { result } = renderHook(() => useApi(query("/a", async () => ({ n: 1 }))), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBeNull();
  });

  it("surfaces the error message, not the error object", async () => {
    const { result } = renderHook(
      () => useApi(query("/b", () => Promise.reject(new Error("API 500 for /b")))),
      { wrapper },
    );
    await waitFor(() => expect(result.current.error).toBe("API 500 for /b"));
    expect(result.current.data).toBeNull();
  });

  /**
   * A screen with nothing to ask for yet must not sit on a spinner. A disabled
   * query is "pending" forever in TanStack's model, so `loading` is mapped
   * explicitly rather than passed through.
   */
  it("does not fetch, or claim to be loading, when the query is null", async () => {
    const run = jest.fn();
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useApi(on ? query("/c", run as () => Promise<unknown>) : null),
      { wrapper, initialProps: { on: false } },
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(run).not.toHaveBeenCalled();

    // ...and starts once it becomes possible.
    run.mockResolvedValue({ ok: true });
    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shares one request between two callers of the same key", async () => {
    const run = jest.fn().mockResolvedValue({ n: 1 });
    // A screen and the footer both asking for /health in the same frame.
    const { result } = renderHook(
      () => [useApi(query("/health", run)), useApi(query("/health", run))] as const,
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].data).toEqual({ n: 1 }));
    expect(result.current[1].data).toEqual({ n: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("useApis", () => {
  it("resolves to results in the order requested", async () => {
    const { result } = renderHook(
      () =>
        useApis([
          query("/1", async () => "first"),
          query("/2", async () => "second"),
        ]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data).toEqual(["first", "second"]);
  });

  it("reports one failure without hiding it behind a permanent spinner", async () => {
    const { result } = renderHook(
      () =>
        useApis([
          query("/ok", async () => "fine"),
          query("/bad", () => Promise.reject(new Error("boom"))),
        ]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
  });
});

describe("useLiveApi", () => {
  /**
   * The rule that matters most on a departure board: a failed refresh must not
   * empty the screen. A rider reading a board through a brief network blip
   * should keep seeing the last known times, with the problem reported beside
   * them rather than instead of them.
   */
  it("keeps the last good data when a refresh fails", async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ trains: 3 })
      .mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useLiveApi(query("/live", run), 10_000), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ trains: 3 }));

    result.current.reload();
    await waitFor(() => expect(result.current.error).toBe("network down"));

    expect(result.current.data).toEqual({ trains: 3 });
    // And never a spinner over data the rider is already reading.
    expect(result.current.loading).toBe(false);
  });

  it("records when the last successful response landed", async () => {
    const { result } = renderHook(
      () => useLiveApi(query("/live2", async () => ({ trains: 1 })), 10_000),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.updatedAtMs).toBeGreaterThan(0);
  });
});
