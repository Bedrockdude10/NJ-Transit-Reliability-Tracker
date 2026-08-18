import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * The selected tab of a grouped page, held in the URL (`?tab=`). Anything
 * unrecognised falls back to the first tab, so a stale link still renders.
 */
export function useTab<T extends string>(tabs: readonly T[]): { tab: T; select: (next: T) => void } {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = tabs.find((t) => t === params.tab) ?? tabs[0];

  const select = useCallback(
    // `setParams`, not `push`: switching tab is not a history entry.
    (next: T) => router.setParams({ tab: next } as never),
    [router],
  );

  return { tab, select };
}
