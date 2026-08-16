import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type MonitorDefinition,
  monitorUrl,
  planMonitors,
  toBetterStackPayload,
} from "../monitors";

const ROOT = resolve(import.meta.dirname, "../..");

const definition = (overrides: Partial<MonitorDefinition> = {}): MonitorDefinition => ({
  name: "NJT API",
  path: "/health",
  checkFrequencySeconds: 60,
  requestTimeoutSeconds: 10,
  confirmationPeriodSeconds: 60,
  recoveryPeriodSeconds: 60,
  ...overrides,
});

describe("monitorUrl", () => {
  it("joins the base and the path", () => {
    expect(monitorUrl("https://njt.fly.dev", definition())).toBe("https://njt.fly.dev/health");
  });

  it("does not double the slash on a base that has one", () => {
    // The difference between one monitor and two monitors for the same check.
    expect(monitorUrl("https://njt.fly.dev/", definition())).toBe("https://njt.fly.dev/health");
  });
});

describe("planMonitors", () => {
  const base = "https://njt.fly.dev";

  it("creates a monitor that does not exist yet", () => {
    const plan = planMonitors(base, [definition()], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it("updates rather than duplicates one that does", () => {
    // Re-running must not leave two monitors alerting on the same URL.
    const plan = planMonitors(base, [definition()], [{ id: "7", url: "https://njt.fly.dev/health" }]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update[0]).toMatchObject({ id: "7" });
  });

  it("is idempotent across repeated runs", () => {
    const remote = [{ id: "7", url: "https://njt.fly.dev/health" }];
    expect(planMonitors(base, [definition()], remote)).toEqual(
      planMonitors(base, [definition()], remote),
    );
  });

  /**
   * Never delete. Someone else's check vanishing because this file did not
   * mention it is a worse outcome than a stale monitor nobody removed.
   */
  it("reports monitors it does not manage and leaves them alone", () => {
    const plan = planMonitors(base, [definition()], [{ id: "9", url: "https://example.com/other" }]);
    expect(plan.unmanaged).toEqual([{ id: "9", url: "https://example.com/other" }]);
    expect(plan).not.toHaveProperty("delete");
  });
});

describe("toBetterStackPayload", () => {
  it("asks for exactly 200, not any non-error status", () => {
    // Better Stack's default monitor type treats the whole 2xx/3xx range as up.
    // `/health/live` distinguishes a running pipeline from a stalled one by
    // answering 200 or 503, so the check has to name the code it wants.
    const payload = toBetterStackPayload(definition(), "https://njt.fly.dev/health/live");
    expect(payload.monitor_type).toBe("expected_status_code");
    expect(payload.expected_status_codes).toEqual([200]);
  });

  it("carries the timings from the definition, not defaults", () => {
    const payload = toBetterStackPayload(
      definition({ checkFrequencySeconds: 300, confirmationPeriodSeconds: 300 }),
      "https://njt.fly.dev/health/live",
    );
    expect(payload).toMatchObject({ check_frequency: 300, confirmation_period: 300 });
  });
});

/**
 * The definitions are the deliverable, so they are checked rather than trusted:
 * a typo in a path is a monitor that watches nothing and reports green.
 */
describe("deploy/monitors.json", () => {
  const { monitors } = JSON.parse(readFileSync(resolve(ROOT, "deploy/monitors.json"), "utf8")) as {
    monitors: MonitorDefinition[];
  };

  it("watches both the site and ingest, which fail independently", () => {
    expect(monitors.map((m) => m.path).sort()).toEqual(["/health", "/health/live"]);
  });

  it("gives every monitor the fields the payload needs", () => {
    for (const monitor of monitors) {
      expect(toBetterStackPayload(monitor, monitorUrl("https://njt.fly.dev", monitor))).toMatchObject({
        check_frequency: expect.any(Number),
        request_timeout: expect.any(Number),
      });
      expect(monitor.name).toBeTruthy();
    }
  });

  it("waits before alerting, so a deploy does not page anyone", () => {
    for (const monitor of monitors) expect(monitor.confirmationPeriodSeconds).toBeGreaterThan(0);
  });
});
