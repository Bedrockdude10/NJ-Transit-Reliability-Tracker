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
