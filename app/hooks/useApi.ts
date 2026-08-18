import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";

export interface ApiResult<T> {
  /** Always present. Absence is handled by the enclosing `QueryBoundary`. */
  data: T;
  /** Set only when a *refresh* failed; a failed first load throws to the boundary. */
  error: Error | null;
  reload: () => void;
}

/**
 * Fetch an API query. There is deliberately no `enabled: false` — suspense
 * queries do not support it; don't render the component until it can fetch.
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
 * Run several queries together, in order. Separate queries rather than one
 * `Promise.all`, so each is cached and retried on its own.
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
