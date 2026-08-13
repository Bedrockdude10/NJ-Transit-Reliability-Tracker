import { useCallback, useEffect, useRef, useState } from "react";

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
 * Differs from {@link useApi} in three ways that matter for a live view:
 *  - `loading` is true only for the *first* load, so a refresh never flashes a
 *    spinner over data the rider is reading.
 *  - a failed refresh keeps the last good data on screen and surfaces the error
 *    alongside it; a transient blip shouldn't empty a board.
 *  - polling pauses when the document is hidden, so a backgrounded tab doesn't
 *    keep hitting the API all night.
 */
export function useLiveApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  intervalMs: number,
): LiveState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const cancelled = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fetcher, deps);

  const run = useCallback(() => {
    load()
      .then((result) => {
        if (cancelled.current) return;
        setData(result);
        setError(null);
        setUpdatedAtMs(Date.now());
      })
      .catch((e: unknown) => {
        // Keep whatever is on screen; only report.
        if (!cancelled.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled.current) setLoading(false);
      });
  }, [load]);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    run();

    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const timer = setInterval(() => {
      if (!hidden()) run();
    }, intervalMs);

    // Catch up immediately when the tab comes back, rather than waiting out
    // the remainder of an interval with stale times on screen.
    const onVisible = () => {
      if (!hidden()) run();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled.current = true;
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run, intervalMs]);

  return { data, loading, error, updatedAtMs, reload: run };
}
