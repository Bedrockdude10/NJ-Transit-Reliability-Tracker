/**
 * Types for `maintenance.mjs`, which is plain JavaScript because the supervisor
 * runs under bare `node` before any TypeScript toolchain is available — while
 * `compact-cli.ts` needs the same flag path, and a path agreed by two files that
 * each define it is a path they will eventually disagree about.
 */

/** The flag whose presence means "do not run the pipeline". */
export function maintenanceFlagPath(dbPath: string): string;

/** What to do with the pipeline, given the flag and whether it is running. */
export function decidePipeline(state: {
  flagPresent: boolean;
  running: boolean;
}): "stop" | "start" | "leave";
