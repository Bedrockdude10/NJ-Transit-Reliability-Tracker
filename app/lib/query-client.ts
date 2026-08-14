import { QueryClient } from "@tanstack/react-query";
import { ApiContractError } from "./api";

/**
 * Defaults for every API query.
 *
 * The API is read-only and backed by daily aggregates (see CLAUDE.md), so a
 * response is safe to reuse briefly; the live endpoints opt out by setting
 * `staleTime: 0` themselves.
 */
export const STALE_TIME_MS = 30_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Matches the 30s TTL of the request cache this replaced, so navigating
        // back to a screen still costs at most one request per key.
        staleTime: STALE_TIME_MS,

        // The hand-rolled client never retried; TanStack would retry three
        // times by default, which hides a genuine error behind a spinner for
        // several seconds. Retry once, and only what might actually recover:
        // a 4xx will not fix itself, and neither will a response that failed
        // contract validation.
        retry: (failureCount, error) => {
          if (error instanceof ApiContractError) return false;
          if (/^API 4\d\d/.test(error.message)) return false;
          return failureCount < 1;
        },

        /**
         * Whether a failure reaches the error boundary or is reported in place.
         *
         * Throw only when there is nothing on screen to keep. A first load that
         * fails has nothing to show, so it belongs to the boundary; a refresh
         * that fails does — and blanking a departure board a rider is reading
         * because one poll timed out is the worst possible response to a blip.
         *
         * This is what lets the live views use Suspense like every other
         * screen. Without it they would need their own non-suspense path, which
         * is exactly the sort of exception that made this app inconsistent.
         */
        throwOnError: (_error, query) => query.state.data === undefined,
      },
    },
  });
}
