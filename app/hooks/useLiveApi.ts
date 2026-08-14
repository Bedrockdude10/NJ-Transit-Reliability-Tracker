import { useQuery } from "@tanstack/react-query";
import type { ApiQuery } from "../lib/api";

export interface LiveState<T> {
  data: T | null;
  /** True only for the first load — a refresh must not blank the screen. */
  loading: boolean;
  error: string | null;
  /** When the last successful response landed, epoch ms. */
  updatedAtMs: number | null;
  reload: () => void;
}

/**
 * Poll an endpoint on an interval, for views that must stay current (the
 * departure board, live train positions).
 *
 * The three behaviours that matter for a live view are all preserved, now as
 * configuration rather than as hand-written effects and refs:
 *
 *  - `loading` is true only for the *first* load (`isPending`), so a refresh
 *    never flashes a spinner over data the rider is reading.
 *  - a failed refresh keeps the last good data on screen and reports the error
 *    beside it; a transient blip should not empty a board. TanStack keeps
 *    `data` across a failed refetch, so this falls out for free.
 *  - polling stops while the tab is hidden and catches up the moment it comes
 *    back, rather than waiting out the remainder of an interval with stale
 *    times on screen. `refetchIntervalInBackground: false` and
 *    `refetchOnWindowFocus` are the defaults; they are named here because they
 *    are load-bearing, not incidental.
 */
export function useLiveApi<T>(query: ApiQuery<T>, intervalMs: number): LiveState<T> {
  const result = useQuery({
    queryKey: query.key,
    queryFn: query.run,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // A live view is only ever interested in the current answer, so never serve
    // a cached one: the previous implementation bypassed its cache entirely for
    // these endpoints.
    staleTime: 0,
  });

  return {
    data: result.data ?? null,
    loading: result.isPending,
    error: result.error ? result.error.message : null,
    updatedAtMs: result.dataUpdatedAt || null,
    reload: () => void result.refetch(),
  };
}
