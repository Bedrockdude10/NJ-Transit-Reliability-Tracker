/**
 * Pausing the pipeline so the database can be worked on.
 *
 * Compaction is the operation this exists for. `VACUUM INTO` reads inside a
 * transaction, so it copies the database as of the moment it started — and the
 * pipeline keeps writing for as long as it runs. Swapping that copy into place
 * afterwards would silently discard every event ingested in between. The copy is
 * only safe to swap in if nothing wrote to the original after it was taken.
 *
 * Stopping the writer is not as simple as killing it, because the supervisor's
 * whole job is to restart children that die — correctly, since that is what
 * turned two pipeline crashes into partial rather than total outages. So the
 * pause has to be something the supervisor understands, not something done
 * behind its back.
 *
 * A file, rather than a signal or a socket: it survives the supervisor being
 * restarted mid-maintenance, it can be inspected and removed with `ls` and `rm`
 * over `fly ssh` when something has gone wrong, and it cannot be lost in a
 * dropped connection. It sits beside the database because that is the resource
 * it protects, and both processes already agree on where that is.
 *
 * The API is deliberately *not* paused. It only reads, and keeping the site up
 * is the point; it is restarted once at the end so it reopens the new file.
 */

/** The flag whose presence means "do not run the pipeline". */
export function maintenanceFlagPath(dbPath) {
  return `${dbPath}.maintenance`;
}

/**
 * What to do with the pipeline, given the flag and whether it is running.
 *
 * Pure, and reconciled on a timer rather than decided once at the moment the
 * flag appears: a decision taken only on the transition is a decision lost if
 * the supervisor restarts while maintenance is under way, and it would come
 * back up writing to a database someone is in the middle of replacing.
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
 * forward SIGTERM to the `sh -c tsx …` beneath it. In production that left the
 * real pipeline reparented to init, still polling NJT and still writing to
 * SQLite, while the supervisor — having watched npm exit — reported ingest
 * stopped and started a second one. Two pipelines then ingested concurrently on
 * a 470 MB box, and `compact` refused to swap because it could still see writes.
 * Its `PRAGMA data_version` check is the only reason that did not silently
 * discard the ingest between the copy and the swap.
 *
 * So the pause has to reach the process that actually holds the database, not
 * the one that happens to be the supervisor's child. Children are spawned
 * `detached`, which makes each the leader of its own process group, and a
 * negative pid signals that whole group. `pipeline/src/main.ts` has always
 * handled SIGTERM — it simply never received one.
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
    // ESRCH means it exited between the check and the signal, which is the
    // outcome wanted anyway. Anything else is worth seeing, because a pause that
    // did not take is the exact failure this path exists to prevent.
    if (error.code !== "ESRCH") io.log?.("could not signal child process group", { pid, error: error.message });
    return false;
  }
}
