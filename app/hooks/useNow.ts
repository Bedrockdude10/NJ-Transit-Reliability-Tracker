import { useEffect, useState } from "react";

/**
 * A clock that re-renders on an interval, for countdowns that must keep moving
 * between data refreshes. A departure board polls every 20s but its "3 min"
 * should tick every second — deriving the countdown from this rather than from
 * the response keeps the two concerns separate.
 *
 * Pauses while the tab is hidden so a backgrounded board isn't re-rendering
 * once a second all night.
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
