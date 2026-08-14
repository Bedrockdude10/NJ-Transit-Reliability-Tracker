import { describe, expect, it } from "vitest";
import {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  decideRestart,
  restartDelayMs,
} from "../restart-policy.mjs";

/**
 * The supervisor used to tear the machine down whenever either child exited,
 * which is what made both of this month's incidents total outages: the pipeline
 * fell over, and the API — which was fine — went with it. Nothing under
 * `deploy/` had a test, so nothing objected.
 */

const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

describe("a child that dies", () => {
  it("is restarted, not escalated, on its first failure", () => {
    // The case that matters: one crash must not take the sibling down.
    const d = decideRestart({ code: 1, failures: [], now: NOW });
    expect(d.action).toBe("restart");
  });

  it("waits longer before each successive restart", () => {
    const delays = [0, 1, 2, 3, 4].map((priorFailures) => restartDelayMs(priorFailures));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    // Capped, so a long-running loop doesn't drift into hour-long gaps.
    expect(restartDelayMs(20)).toBe(30_000);
  });

  it("backs off further as failures accumulate", () => {
    const first = decideRestart({ code: 1, failures: [], now: NOW });
    const second = decideRestart({ code: 1, failures: [NOW - 1000], now: NOW });
    expect(second.delayMs).toBeGreaterThan(first.delayMs);
  });
});

describe("a child that exits cleanly", () => {
  it("is left alone", () => {
    // Exit 0 is a job finished, not a fall — restarting it would loop forever.
    expect(decideRestart({ code: 0, failures: [], now: NOW }).action).toBe("ignore");
  });

  it("does not accrue a failure against itself", () => {
    const d = decideRestart({ code: 0, failures: [NOW - 5_000], now: NOW });
    expect(d.failures).toEqual([NOW - 5_000]);
  });
});

describe("a child stuck in a crash loop", () => {
  it("escalates once the restarts are exhausted", () => {
    // A wedged volume or an unfree port needs a fresh machine, and only the
    // platform can provide one — so persistent failure must still give up.
    const failures = Array.from({ length: MAX_RESTARTS }, (_, i) => NOW - (i + 1) * 1000);
    expect(decideRestart({ code: 1, failures, now: NOW }).action).toBe("escalate");
  });

  it("allows exactly MAX_RESTARTS restarts before giving up", () => {
    let failures = [];
    const actions = [];
    for (let i = 0; i < MAX_RESTARTS + 1; i++) {
      const d = decideRestart({ code: 1, failures, now: NOW + i });
      failures = d.failures;
      actions.push(d.action);
    }
    expect(actions.filter((a) => a === "restart")).toHaveLength(MAX_RESTARTS);
    expect(actions.at(-1)).toBe("escalate");
  });
});

describe("failures age out", () => {
  it("forgives failures older than the window", () => {
    // A process up for days should not be escalated over a bad ten minutes
    // last week — otherwise every long-lived machine eventually dies.
    const ancient = Array.from({ length: MAX_RESTARTS }, () => NOW - RESTART_WINDOW_MS - 1);
    const d = decideRestart({ code: 1, failures: ancient, now: NOW });
    expect(d.action).toBe("restart");
    expect(d.failures).toEqual([NOW]);
  });

  it("still counts failures inside the window", () => {
    const recent = Array.from({ length: MAX_RESTARTS }, () => NOW - RESTART_WINDOW_MS + 1);
    expect(decideRestart({ code: 1, failures: recent, now: NOW }).action).toBe("escalate");
  });
});

describe("an exit with no code", () => {
  it("counts as a failure rather than a clean exit", () => {
    // A child killed by a signal reports code null; that is a fall, not a
    // finish, and the old code's `code ?? 1` treated it as one.
    expect(decideRestart({ code: null, failures: [], now: NOW }).action).toBe("restart");
  });
});
