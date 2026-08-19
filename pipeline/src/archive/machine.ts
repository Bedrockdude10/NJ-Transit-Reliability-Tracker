import { readFileSync } from "node:fs";

const MEMAVAILABLE_RE = /^MemAvailable:\s+(?<kB>\d+) kB$/mu;

/**
 * How much room a job has on the machine it is about to run on. Being OOM-killed
 * reports itself only as exit code 137, so jobs check first and say what they need.
 */

/**
 * Allocatable memory in MB, from `/proc/meminfo`, or null off Linux (the check is
 * then skipped).
 *
 * `MemAvailable`, not `MemFree` or `os.freemem()`: only it estimates what a new
 * process can get without swapping. `os.freemem()` counts free pages, and reported
 * 71 MB on a 64 GB macOS machine.
 */
export function parseAvailableMemoryMb(meminfo: string): number | null {
  const match = MEMAVAILABLE_RE.exec(meminfo);
  return match ? Math.floor(Number(match.groups?.kB) / 1024) : null;
}

/**
 * Why a job cannot run now, or null.
 *
 * Compares the memory *still* to be taken, not the total: by the time this runs the
 * process already holds most of its footprint and `MemAvailable` reflects that, so
 * requiring the full figure on top counts the process twice and refuses valid runs.
 */
export function insufficientMemory(
  job: string,
  requiredMb: number,
  availableMb: number | null,
  alreadyHeldMb: number = process.memoryUsage().rss / 1_048_576,
): string | null {
  const stillNeededMb = Math.max(0, requiredMb - alreadyHeldMb);
  if (availableMb === null || availableMb >= stillNeededMb) return null;
  return (
    `not enough memory to ${job}: needs ~${stillNeededMb} MB more (~${requiredMb} MB in total, ` +
    `${Math.round(alreadyHeldMb)} MB already held), ${availableMb} MB available. ` +
    `Retrying next run, or give the machine more memory.`
  );
}

/** Allocatable memory now, or null where the kernel does not say. */
export function availableMemoryMb(): number | null {
  try {
    return parseAvailableMemoryMb(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}
