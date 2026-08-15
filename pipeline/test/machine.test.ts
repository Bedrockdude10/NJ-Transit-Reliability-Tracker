import { describe, expect, it } from "vitest";
import { insufficientMemory, parseAvailableMemoryMb } from "../src/archive/machine";

/**
 * Maintenance jobs share a 512 MB machine with the API and the pipeline, so each
 * checks there is room before it starts.
 */

describe("fitting on the machine", () => {
  it("reads the kernel's own estimate of what is allocatable", () => {
    // MemAvailable, not MemFree: the two differ by the reclaimable page cache,
    // which is most of a busy machine's memory.
    expect(
      parseAvailableMemoryMb("MemTotal: 469852 kB\nMemFree:  130360 kB\nMemAvailable:     184384 kB\n"),
    ).toBe(180);
  });

  it("skips the check where the kernel does not answer, rather than guessing", () => {
    // Off Linux there is no MemAvailable. os.freemem() is not a substitute — on
    // macOS it counts free pages and reported 71 MB on a 64 GB machine.
    expect(parseAvailableMemoryMb("VmStat: nope")).toBeNull();
    expect(insufficientMemory("copy", 160, null, 0)).toBeNull();
  });

  it("counts only the memory still to be taken, not this process twice", () => {
    // By the time the check runs, the process already holds most of its
    // footprint and MemAvailable already reflects it. Asking for the full figure
    // on top refused run after run on a machine with 168 MB free.
    expect(insufficientMemory("copy", 160, 40, 0)).toMatch(/not enough memory to copy/);
    expect(insufficientMemory("copy", 160, 40, 1_000)).toBeNull();
  });

  it("names the job that cannot run, since several share the machine", () => {
    expect(insufficientMemory("export events", 160, 1, 0)).toMatch(/export events/);
  });
});
