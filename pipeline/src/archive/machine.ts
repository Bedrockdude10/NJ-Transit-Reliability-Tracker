import { readFileSync } from "node:fs";

/**
 * How much room a job has on the machine it is about to run on.
 *
 * The ingest box has 512 MB, ~280 MB of it held by the API and the pipeline, and
 * every maintenance job runs beside them. Being OOM-killed is survivable — these
 * jobs confirm before they delete — but it reports itself only as exit code 137,
 * so they check first and say what they need.
 */

/**
 * Allocatable memory in MB, from `/proc/meminfo`, or null where that is not the
 * kernel's own answer.
 *
 * `MemAvailable` specifically, not `MemFree`: it is the kernel's estimate of what
 * a new process can get without swapping, which is the question being asked.
 * `os.freemem()` was tried first and is not that — on macOS it counts free pages
 * and reported 71 MB on a 64 GB machine.
 *
 * Returns null off Linux rather than guessing, and the check is then skipped: a
 * developer machine is not where this needs protecting.
 */
export function parseAvailableMemoryMb(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo);
  return match ? Math.floor(Number(match[1]) / 1024) : null;
}

/**
 * Why a job cannot run now, or null.
 *
 * What matters is the memory still to be taken, not the total: by the time this
 * runs the process already holds most of its eventual footprint, and
 * `MemAvailable` already reflects that. Asking for the full figure on top of what
 * had been taken counted the process twice, and refused run after run on a
 * machine with 168 MB free.
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
