import { useEffect, useState } from "react";

/**
 * A clock that re-renders on an interval, so a countdown ticks every second
 * without refetching. Pauses while the tab is hidden.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const tick = () => {
      if (!hidden()) setNow(Date.now());
    };
    const timer = setInterval(tick, intervalMs);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return now;
}
