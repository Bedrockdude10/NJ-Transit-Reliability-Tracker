/**
 * When a supervised child dies, what should happen to it.
 *
 * Split out from `start.mjs` and kept pure so it can be tested: this decision
 * is what turned both of this month's incidents into full outages, and until
 * now nothing under `deploy/` had a single test. The spawn plumbing around it
 * is still verified by hand (kill the child, watch it come back); the judgement
 * is verified here.
 */

/**
 * A crash loop is a real failure that a fresh machine might actually fix — a
 * wedged volume, a port that never frees — so repeated failures still escalate.
 * But only after restarts have had a fair chance.
 */
export const MAX_RESTARTS = 5;

/**
 * Failures older than this are forgiven, so a process that has run for days is
 * not escalated because of a bad ten minutes last Tuesday.
 */
export const RESTART_WINDOW_MS = 10 * 60 * 1000;

/** 1s, 2s, 4s, 8s, 16s, capped — enough to outlast a transient lock. */
export function restartDelayMs(priorFailures) {
  return Math.min(1000 * 2 ** priorFailures, 30_000);
}

/**
 * Decide what to do about a child that just exited.
 *
 * @param {{ code: number | null, failures: number[], now: number }} event
 *   `failures` are the timestamps of this child's earlier failures.
 * @returns {{ action: "ignore" | "restart" | "escalate", delayMs?: number, failures: number[] }}
 *   `failures` is the pruned list to carry forward.
 */
export function decideRestart({ code, failures, now }) {
  // A clean exit is a process that finished its job, not one that fell over.
  if (code === 0) return { action: "ignore", failures };

  const recent = [...failures.filter((at) => now - at < RESTART_WINDOW_MS), now];

  // Strictly greater: MAX_RESTARTS restarts are allowed, the next one escalates.
  if (recent.length > MAX_RESTARTS) return { action: "escalate", failures: recent };

  return { action: "restart", delayMs: restartDelayMs(recent.length - 1), failures: recent };
}
