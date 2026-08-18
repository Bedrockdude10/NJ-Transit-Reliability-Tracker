/**
 * Types for `maintenance.mjs`, which is plain JavaScript because the supervisor runs
 * under bare `node` before any TypeScript toolchain is available.
 */

/** The flag whose presence means "do not run the pipeline". */
export function maintenanceFlagPath(dbPath: string): string;

/** What to do with the pipeline, given the flag and whether it is running. */
export function decidePipeline(state: {
  flagPresent: boolean;
  running: boolean;
}): "stop" | "start" | "leave";
