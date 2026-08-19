import { QueryClient } from "@tanstack/react-query";
import { ApiContractError } from "./api";

/** Defaults for every API query. Live endpoints opt out with `staleTime: 0`. */
export const STALE_TIME_MS = 30_000;

const API_4XX_RE = /^API 4\d\d/u;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,

        // Retry once, and only what might recover: a 4xx will not fix itself,
        // and neither will a response that failed contract validation.
        retry: (failureCount, error) => {
          if (error instanceof ApiContractError) return false;
          if (API_4XX_RE.test(error.message)) return false;
          return failureCount < 1;
        },

        /**
         * Throw to the boundary only when there is nothing on screen to keep, so
         * a failed poll does not blank a departure board a rider is reading.
         */
        throwOnError: (_error, query) => query.state.data === undefined,
      },
    },
  });
}
