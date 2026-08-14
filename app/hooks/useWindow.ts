import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import type { DateRange } from "../lib/api";
import { parseWindowKey, windowDays, windowToRange, type WindowKey } from "../lib/windows";

export interface SelectedWindow {
  key: WindowKey;
  /** The `{from,to}` the key resolves to — derived, never stored. */
  range: Required<DateRange>;
  select: (key: WindowKey) => void;
}

/**
 * The selected time window, held in the URL.
 *
 * Seven screens each declared their own version of this, as *two* pieces of
 * state — `windowKey` and `days` — kept in step by hand inside the picker's
 * `onChange`. `days` is a pure function of `key`, so that second variable was
 * a redundant source of truth duplicated seven times, and every screen's
 * default was chosen independently with nothing saying why.
 *
 * Worse, the state had two different homes: `/commute` kept the window in the
 * URL while the other six kept it in `useState`. So a commute was shareable
 * and a map at 7d was not, and switching window then navigating away silently
 * lost the choice. The commute screen was already doing this correctly; this
 * hook is that approach extracted, not a new invention.
 *
 * `fallback` is the window a screen opens at when the URL says nothing — the
 * map wants a wider default than the dashboard. It is a default, not state:
 * once the URL carries a window, the URL wins.
 */
export function useWindow(fallback: WindowKey = "30d"): SelectedWindow {
  const router = useRouter();
  const params = useLocalSearchParams<{ window?: string }>();

  // Anything unrecognised in the URL falls back rather than leaving the picker
  // unable to represent the current state.
  const key = parseWindowKey(params.window, fallback);
  const range = useMemo(() => windowToRange(windowDays(key)), [key]);

  const select = useCallback(
    (next: WindowKey) => {
      // `setParams` rather than `push`, so choosing a window is not a new
      // history entry to back out of one at a time.
      router.setParams({ window: next } as never);
    },
    [router],
  );

  return { key, range, select };
}
