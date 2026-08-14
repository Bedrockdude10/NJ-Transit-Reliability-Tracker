import { useQueries, useQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetch an API query, tracking loading and error state.
 *
 * A thin adapter over TanStack Query, kept so screens read the same way they
 * always have. What it replaced was ~200 lines of hand-rolled caching, in-flight
 * de-duplication and cancellation, plus a dependency array each caller had to
 * keep in step with its own fetcher by hand — a duplication that had already
 * gone wrong. The key now comes from {@link ApiQuery}, so it cannot disagree
 * with the request.
 *
 * `data` is `null` rather than `undefined` while loading, matching the screens'
 * existing null checks.
 *
 * Pass `null` for a query that is not ready to run — the commute screen has no
 * request to make until both stations are chosen. It reports `loading: false`
 * in that state, so the screen shows its prompt rather than a spinner that
 * would never resolve.
 */
export function useApi<T>(query: ApiQuery<T> | null): AsyncState<T> {
  const result = useQuery({
    queryKey: query?.key ?? ["idle"],
    queryFn: () => query!.run(),
    enabled: query !== null,
  });

  return {
    data: result.data ?? null,
    // `isPending` is true only when there is nothing to show. A background
    // refetch of already-loaded data must not put a spinner over it — and a
    // disabled query is pending forever, hence the explicit check.
    loading: query !== null && result.isPending,
    error: result.error ? result.error.message : null,
    reload: () => void result.refetch(),
  };
}

/**
 * Run several queries together, resolving to an array in the same order.
 *
 * The comparison screen fetches one line's monthly figures per selected line.
 * As a single `Promise.all` those shared one cache entry and one failure; as
 * separate queries each is cached, deduped and retried on its own, so adding a
 * third line to a comparison refetches only the third.
 */
export function useApis<T>(queries: readonly ApiQuery<T>[]): AsyncState<T[]> {
  const results = useQueries({
    queries: queries.map((q) => ({ queryKey: q.key, queryFn: q.run })),
  });

  const failed = results.find((r) => r.error);
  const settled = results.every((r) => r.data !== undefined);

  return {
    data: settled ? results.map((r) => r.data as T) : null,
    loading: !settled && !failed,
    error: failed?.error ? failed.error.message : null,
    reload: () => {
      for (const r of results) void r.refetch();
    },
  };
}
