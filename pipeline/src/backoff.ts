import type { Clock } from "./clock";
import { systemClock } from "./clock";

/** Exponential backoff delay (ms) for a zero-based attempt, capped at `maxMs`. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

export interface RetryOptions {
  /** Number of retries after the first attempt (so total attempts = retries + 1). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  clock?: Clock;
  /** Called for each failed attempt; useful for logging. */
  onError?: (error: unknown, attempt: number) => void;
}

/**
 * Run `fn`, retrying on rejection with exponential backoff. Rethrows the last
 * error once retries are exhausted — callers must not write partial records on
 * failure (PRD: "do not write null or partial records").
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const clock = options.clock ?? systemClock;
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      options.onError?.(error, attempt);
      if (attempt < options.retries) {
        await clock.sleep(backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs));
      }
    }
  }
  throw lastError;
}
