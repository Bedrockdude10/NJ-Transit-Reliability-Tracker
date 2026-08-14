import { useSuspenseQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";
import type { ApiResult } from "./useApi";

export interface LiveResult<T> extends ApiResult<T> {
  /** When the last successful response landed, epoch ms. */
  updatedAtMs: number;
}

/**
 * Poll an endpoint on an interval, for views that must stay current — the
 * departure board, live train positions.
 *
 * This is now {@link useApi} plus a refetch interval. It used to be a separate
 * 80-line hook with its own cancellation ref, timer and visibility listener,
 * because the rule it enforced — a failed refresh must never blank a board a
 * rider is reading — looked incompatible with throwing errors to a boundary.
 *
 * It isn't. The `throwOnError` predicate in `query-client.ts` only throws when
 * there is nothing on screen to keep, so a failed poll leaves the times in
 * place and surfaces `error` beside them. What was one screen's special case
 * is now how every screen behaves, and the difference here is a single option.
 */
export function useLiveApi<T>(query: ApiQuery<T>, intervalMs: number): LiveResult<T> {
  const result = useSuspenseQuery({
    queryKey: query.key,
    queryFn: query.run,
    refetchInterval: intervalMs,
    // Stop polling while the tab is hidden, and catch up the moment it returns
    // rather than waiting out the remainder of an interval with stale times on
    // screen. Both are defaults; they are named because they are load-bearing.
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
