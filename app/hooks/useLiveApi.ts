import { useSuspenseQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";
import type { ApiResult } from "./useApi";

export interface LiveResult<T> extends ApiResult<T> {
  /** When the last successful response landed, epoch ms. */
  updatedAtMs: number;
}

/**
 * {@link useApi} plus a refetch interval, for views that must stay current. A
 * failed poll leaves the times on screen and surfaces `error` beside them —
 * see `throwOnError` in `query-client.ts`.
 */
export function useLiveApi<T>(query: ApiQuery<T>, intervalMs: number): LiveResult<T> {
  const result = useSuspenseQuery({
    queryKey: query.key,
    queryFn: query.run,
    refetchInterval: intervalMs,
    // Defaults, named because they are load-bearing: pause while hidden, and
    // catch up on return rather than waiting out the interval with stale times.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // A live view only ever wants the current answer, never a cached one.
    staleTime: 0,
  });

  return {
    data: result.data,
    error: result.error,
    updatedAtMs: result.dataUpdatedAt,
    reload: () => void result.refetch(),
  };
}
