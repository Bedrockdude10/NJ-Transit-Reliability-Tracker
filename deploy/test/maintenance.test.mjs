import { describe, expect, it } from "vitest";
import { decidePipeline, maintenanceFlagPath } from "../maintenance.mjs";

/**
 * The pause exists so a compaction can swap in a copy of the database without
 * losing the writes made while it was being taken. Getting this wrong in either
 * direction is expensive: not stopping loses data, and not restarting leaves
 * ingest silently off — which is a permanent gap, since NJT serves no history.
 */

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
    // The half that a one-shot handler gets wrong: the supervisor's ordinary
    // restart-on-exit must not undo the pause a second after it took effect.
    expect(decidePipeline({ flagPresent: true, running: false })).toBe("leave");
  });

  it("leaves a running pipeline alone in normal operation", () => {
    expect(decidePipeline({ flagPresent: false, running: true })).toBe("leave");
  });

  it("is reconciled from state, so a supervisor restart mid-maintenance still pauses", () => {
    // A supervisor that came back up during maintenance sees flag present and
    // nothing running, and must not start writing to a database being replaced.
    expect(decidePipeline({ flagPresent: true, running: false })).toBe("leave");
  });
});
