import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";

export interface ApiResult<T> {
  /** Always present. Absence is handled by the enclosing `QueryBoundary`. */
  data: T;
  /**
   * Set only when a *refresh* failed while data was already on screen. A first
   * load that fails never reaches here — it throws to the boundary instead.
   */
  error: Error | null;
  reload: () => void;
}

/**
 * Fetch an API query.
 *
 * `data` is non-nullable, which is the whole point: screens no longer open with
 * `if (loading) … if (error) … if (!data) …`. There were 33 of those ladders
 * across 13 screens, each answering "what does pending look like" and "does an
 * error replace the data or sit beside it" slightly differently. `Suspense` and
 * the error boundary in {@link QueryBoundary} answer both, once.
 *
 * A query that is not ready to run has no `enabled: false` here, deliberately —
 * suspense queries do not support it, and the React answer is better: don't
 * render the component that needs the data until it can be fetched.
 */
export function useApi<T>(query: ApiQuery<T>): ApiResult<T> {
  const result = useSuspenseQuery({ queryKey: query.key, queryFn: query.run });
  return {
    data: result.data,
    error: result.error,
    reload: () => void result.refetch(),
  };
}

/**
 * Run several queries together, resolving to results in the same order.
 *
 * The comparison screen fetches one line's monthly figures per selected line.
 * As a single `Promise.all` those shared one cache entry and one failure; as
 * separate queries each is cached, deduped and retried on its own, so adding a
 * third line to a comparison refetches only the third.
 */
export function useApis<T>(queries: readonly ApiQuery<T>[]): ApiResult<T[]> {
  const results = useSuspenseQueries({
    queries: queries.map((q) => ({ queryKey: q.key, queryFn: q.run })),
  });
  return {
    data: results.map((r) => r.data as T),
    error: results.find((r) => r.error)?.error ?? null,
    reload: () => {
      for (const r of results) void r.refetch();
    },
  };
}
