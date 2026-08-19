import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decidePipeline, maintenanceFlagPath, stopProcessTree } from "../maintenance.mjs";

describe("maintenanceFlagPath", () => {
  it("sits beside the database it protects", () => {
    expect(maintenanceFlagPath("/data/njt.sqlite")).toBe("/data/njt.sqlite.maintenance");
  });
});

describe("decidePipeline", () => {
  it("stops a running pipeline once the flag is there", () => {
    expect(decidePipeline({ flagPresent: true, running: true })).toBe("stop");
  });

  it("restarts it once the flag is gone", () => {
    expect(decidePipeline({ flagPresent: false, running: false })).toBe("start");
  });

  it("leaves a stopped pipeline stopped while the flag remains", () => {
    // The supervisor's ordinary restart-on-exit must not undo the pause.
    expect(decidePipeline({ flagPresent: true, running: false })).toBe("leave");
  });

  it("leaves a running pipeline alone in normal operation", () => {
    expect(decidePipeline({ flagPresent: false, running: true })).toBe("leave");
  });

  it("is reconciled from state, so a supervisor restart mid-maintenance still pauses", () => {
    // Flag present, nothing running: must not write to a database being replaced.
    expect(decidePipeline({ flagPresent: true, running: false })).toBe("leave");
  });
});

describe("stopProcessTree", () => {
  it("reports the signal it could not deliver, and stays quiet about a race", () => {
    const logged = [];
    const log = (message, meta) => logged.push({ message, meta });

    // Already gone between the check and the signal: the outcome we wanted.
    const gone = stopProcessTree(123, {
      kill: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
      log,
    });
    expect(gone).toBe(false);
    expect(logged).toEqual([]);

    // Anything else means the pause may not have taken.
    stopProcessTree(123, {
      kill: () => {
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      },
      log,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toMatch(/could not signal/u);
  });

  it("signals the group, not just the leader", () => {
    expect(stopProcessTree(4242, { kill: (pid) => expect(pid).toBe(-4242) })).toBe(true);
  });
});

/**
 * Real processes, not mocks: the defect is about which process a signal reaches, and
 * every mock of `kill` passes whether or not the fix is there. The shape mirrors
 * production — a wrapper that exits on SIGTERM without forwarding it (npm) over a
 * worker that would handle SIGTERM if it ever got one (the pipeline).
 */
describe("stopping a child that spawned its own children", () => {
  const worker = "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);";
  const wrapper = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(worker)}], { stdio: "ignore" });
    process.stdout.write(String(child.pid));
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1000);
  `;

  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

  /** @returns {Promise<{leader: number, grandchild: number}>} */
  function launch() {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["-e", wrapper], {
        stdio: ["ignore", "pipe", "ignore"],
        detached: true,
      });
      child.stdout.once("data", (buf) =>
        resolve({ leader: child.pid, grandchild: Number(String(buf).trim()) }),
      );
    });
  }

  it("kills the grandchild too, so nothing is left writing to the database", async () => {
    const { leader, grandchild } = await launch();
    expect(alive(grandchild)).toBe(true);

    stopProcessTree(leader);
    await settle();

    expect(alive(leader)).toBe(false);
    // The assertion that matters: before the fix this was still holding the file open.
    expect(alive(grandchild)).toBe(false);
  });

  it("demonstrates the bug: signalling the leader alone orphans the worker", async () => {
    const { leader, grandchild } = await launch();

    process.kill(leader, "SIGTERM"); // what `child.kill()` did
    await settle();

    expect(alive(leader)).toBe(false);
    expect(alive(grandchild)).toBe(true); // reparented to init, still running

    // Directly, not via stopProcessTree: the orphan is not a group leader.
    process.kill(grandchild, "SIGTERM");
    await settle();
    expect(alive(grandchild)).toBe(false);
  });
});
