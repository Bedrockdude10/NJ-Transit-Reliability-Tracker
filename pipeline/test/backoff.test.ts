import { describe, expect, it, vi } from "vitest";
import type { Clock } from "../src/clock";
import { backoffDelay, withRetry } from "../src/backoff";

function fakeClock(): { clock: Clock; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => 0,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  };
}

describe("backoffDelay", () => {
  it("doubles and caps at maxMs", () => {
    expect(backoffDelay(0, 500, 5000)).toBe(500);
    expect(backoffDelay(1, 500, 5000)).toBe(1000);
    expect(backoffDelay(3, 500, 5000)).toBe(4000);
    expect(backoffDelay(4, 500, 5000)).toBe(5000); // 8000 capped
  });
});

describe("withRetry", () => {
  it("returns immediately on success with no sleeps", async () => {
    const { clock, sleeps } = fakeClock();
    const result = await withRetry(() => Promise.resolve("ok"), { retries: 3, baseDelayMs: 1, maxDelayMs: 9, clock });
    expect(result).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("retries then succeeds", async () => {
    const { clock, sleeps } = fakeClock();
    const fn = vi.fn().mockRejectedValueOnce(new Error("a")).mockRejectedValueOnce(new Error("b")).mockResolvedValue("ok");
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 10, maxDelayMs: 100, clock });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]); // two backoffs before the third try
  });

  it("rethrows after exhausting retries and reports each failure", async () => {
    const { clock } = fakeClock();
    const onError = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1, maxDelayMs: 1, clock, onError })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
