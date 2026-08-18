import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import type { Ingestor } from "./ingestor";
import { type RateLimiter, planPoll } from "./rate-limiter";

export interface RunningScheduler {
  stop(): void;
}

/**
 * Each feed self-reschedules via setTimeout, so the TripUpdates interval can stretch
 * under budget pressure and lower-priority feeds can be skipped independently.
 */
export function startScheduler(
  ingestor: Ingestor,
  rateLimiter: RateLimiter,
  config: PipelineConfig,
  clock: Clock = systemClock,
): RunningScheduler {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const loop = (task: () => unknown, nextDelayMs: () => number): void => {
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        await task();
      } finally {
        if (!stopped) schedule();
      }
    };
    const schedule = (): void => {
      const timer = setTimeout(tick, nextDelayMs());
      timers.add(timer);
    };
    schedule();
  };

  loop(
    () => ingestor.pollTripUpdates(),
    () => config.intervals.tripUpdatesMs * planPoll(rateLimiter, clock.now()).intervalMultiplier,
  );
  loop(
    () => (planPoll(rateLimiter, clock.now()).vehiclePositions ? ingestor.pollVehiclePositions() : undefined),
    () => config.intervals.vehiclePositionsMs,
  );
  loop(
    () => (planPoll(rateLimiter, clock.now()).serviceAlerts ? ingestor.pollServiceAlerts() : undefined),
    () => config.intervals.serviceAlertsMs,
  );
  loop(() => ingestor.recompute(), () => config.intervals.hourlyRecomputeMs);
  loop(() => ingestor.checkStaleness(), () => config.intervals.stalenessCheckMs);

  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
