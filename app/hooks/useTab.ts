import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * The selected tab of a grouped page, held in the URL (`?tab=`).
 *
 * Same reasoning as `useWindow`: which panel you are looking at is state a
 * reader would bookmark or send to someone, so it belongs in the URL rather
 * than in `useState`. Anything unrecognised falls back to the first tab, so a
 * stale or hand-edited link renders the page instead of an empty frame.
 */
export function useTab<T extends string>(tabs: readonly T[]): { tab: T; select: (next: T) => void } {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = tabs.find((t) => t === params.tab) ?? tabs[0];

  const select = useCallback(
    // `setParams`, not `push` — switching tab is not a history entry to back
    // out of one at a time.
    (next: T) => router.setParams({ tab: next } as never),
    [router],
  );

  return { tab, select };
}
