import type { Logger } from "@njt/shared/logger";

/**
 * Repeat `tick` until the process is signalled. One of these per container: each
 * resident Node process costs ~90 MB of the machine's 512 MB whether it is doing
 * anything or not, which is memory the export's own guard then finds missing.
 */
export interface ResidentLoop {
  everySeconds: number;
  tick: () => Promise<void>;
  /** Released once, after the last tick. */
  close?: () => void;
  log?: Logger;
}

export async function runResident(loop: ResidentLoop): Promise<void> {
  const guarded = async (): Promise<void> => {
    try {
      await loop.tick();
    } catch (error) {
      // A pass fails on a held lock, a memory shortfall, or a day that does not
      // match the contract. The next tick may clear it; dying would need a restart.
      loop.log?.error("pass failed; retrying next tick", { error: String(error) });
    }
  };

  const interval = setInterval(guarded, loop.everySeconds * 1000);
  const stop = (): void => {
    clearInterval(interval);
    loop.close?.();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  await guarded();
}
