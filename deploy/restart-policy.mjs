export const MAX_RESTARTS = 5;

/** Failures older than this are forgiven, so a bad ten minutes never escalates later. */
export const RESTART_WINDOW_MS = 10 * 60 * 1000;

/** 1s, 2s, 4s, 8s, 16s, capped — enough to outlast a transient lock. */
export function restartDelayMs(priorFailures) {
  return Math.min(1000 * 2 ** priorFailures, 30_000);
}

/**
 * @param {{ code: number | null, failures: number[], now: number }} event
 *   `failures` are the timestamps of this child's earlier failures.
 * @returns {{ action: "ignore" | "restart" | "escalate", delayMs?: number, failures: number[] }}
 *   `failures` is the pruned list to carry forward.
 */
export function decideRestart({ code, failures, now }) {
  if (code === 0) return { action: "ignore", failures };

  const recent = [...failures.filter((at) => now - at < RESTART_WINDOW_MS), now];

  // Strictly greater: MAX_RESTARTS restarts are allowed, the next one escalates.
  if (recent.length > MAX_RESTARTS) return { action: "escalate", failures: recent };

  return { action: "restart", delayMs: restartDelayMs(recent.length - 1), failures: recent };
}
