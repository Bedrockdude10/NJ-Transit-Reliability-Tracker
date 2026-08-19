import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import type { DateRange } from "../lib/api";
import {
  DEFAULT_WINDOW_KEY,
  parseWindowKey,
  windowDays,
  windowToRange,
  type WindowKey,
} from "../lib/windows";

export interface SelectedWindow {
  key: WindowKey;
  /** The `{from,to}` the key resolves to — derived, never stored. */
  range: Required<DateRange>;
  select: (key: WindowKey) => void;
}

/**
 * The selected time window, held in the URL so it is shareable and survives
 * navigation. `fallback` is only what the screen opens at when the URL says
 * nothing; once the URL carries a window, the URL wins.
 */
export function useWindow(fallback: WindowKey = DEFAULT_WINDOW_KEY): SelectedWindow {
  const router = useRouter();
  const params = useLocalSearchParams<{ window?: string }>();

  // Anything unrecognised falls back, so the picker can always represent the state.
  const key = parseWindowKey(params.window, fallback);
  const range = useMemo(() => windowToRange(windowDays(key)), [key]);

  const select = useCallback(
    (next: WindowKey) => {
      // `setParams`, not `push`: a window choice is not a history entry.
      router.setParams({ window: next } as never);
    },
    [router],
  );

  return { key, range, select };
}
