/**
 * Pausing the pipeline so the database can be worked on. A file rather than a
 * signal: it survives the supervisor restarting mid-maintenance, and can be
 * inspected and removed with `ls`/`rm` over `fly ssh` when something has gone wrong.
 */

/** The flag whose presence means "do not run the pipeline". */
export function maintenanceFlagPath(dbPath) {
  return `${dbPath}.maintenance`;
}

/**
 * What to do with the pipeline, given the flag and whether it is running.
 *
 * Reconciled on a timer, not decided on the transition: a decision taken only when
 * the flag appears is lost if the supervisor restarts mid-maintenance, and it comes
 * back up writing to a database someone is replacing.
 *
 * @param {{flagPresent: boolean, running: boolean}} state
 * @returns {"stop" | "start" | "leave"}
 */
export function decidePipeline({ flagPresent, running }) {
  if (flagPresent && running) return "stop";
  if (!flagPresent && !running) return "start";
  return "leave";
}

/**
 * Signal a child *and everything it spawned*.
 *
 * `child.kill()` reaches only the direct child, which is `npm` — and npm does not
 * forward SIGTERM to the `sh -c tsx …` beneath it, leaving the real pipeline
 * reparented to init and still writing while the supervisor starts a second one.
 * Children are spawned `detached` so a negative pid signals the whole group.
 *
 * @param {number | undefined} pid the group leader, i.e. the spawned child
 * @param {{kill?: (pid: number, signal: string) => void, log?: (message: string, meta?: object) => void}} [io]
 * @returns {boolean} whether a signal was delivered
 */
export function stopProcessTree(pid, io = {}) {
  if (!pid) return false;
  const kill = io.kill ?? ((target, signal) => process.kill(target, signal));
  try {
    kill(-pid, "SIGTERM");
    return true;
  } catch (error) {
    if (error.code !== "ESRCH") io.log?.("could not signal child process group", { pid, error: error.message });
    return false;
  }
}
