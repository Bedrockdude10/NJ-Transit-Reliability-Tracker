/** Injectable time + sleep, so schedulers and retries are testable. */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Resolve after `ms`. */
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
