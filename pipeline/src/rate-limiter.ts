import type { HealthRepository } from "@njt/db";
import { RATE_LIMITS } from "@njt/shared";

export type BudgetGroup = "gtfs_rt" | "xml_api";

/**
 * Tracks daily request budgets against the NJT limits and decides how to
 * degrade as a budget fills. Counts are persisted via the health repo so they
 * survive a pipeline restart within the same UTC day.
 */
export class RateLimiter {
  constructor(
    private readonly health: HealthRepository,
    private readonly limits: typeof RATE_LIMITS = RATE_LIMITS,
  ) {}

  private limitFor(group: BudgetGroup): number {
    return group === "gtfs_rt" ? this.limits.gtfsRtPerDay : this.limits.xmlApiPerDay;
  }

  used(group: BudgetGroup, now: number): number {
    return this.health.budgetUsed(group, now);
  }

  remaining(group: BudgetGroup, now: number): number {
    return Math.max(0, this.limitFor(group) - this.used(group, now));
  }

  usedFraction(group: BudgetGroup, now: number): number {
    return this.used(group, now) / this.limitFor(group);
  }

  /** True while at least the required headroom (default 20%) is unused. */
  withinHeadroom(group: BudgetGroup, now: number): boolean {
    return this.usedFraction(group, now) <= 1 - this.limits.headroomFraction;
  }

  record(group: BudgetGroup, count: number, now: number): void {
    this.health.incrementBudget(group, count, now);
  }
}

export interface PollPlan {
  tripUpdates: boolean;
  vehiclePositions: boolean;
  serviceAlerts: boolean;
  xml: boolean;
  /** Multiplier (>= 1) applied to base TripUpdates interval when degrading. */
  intervalMultiplier: number;
}

/**
 * Graceful-degradation policy as the GTFS-RT budget fills (PRD: extend
 * TripUpdates before dropping anything; drop VehiclePositions before
 * TripUpdates; never drop TripUpdates).
 */
export function planPoll(limiter: RateLimiter, now: number): PollPlan {
  const gtfs = limiter.usedFraction("gtfs_rt", now);
  return {
    tripUpdates: true, // never dropped
    vehiclePositions: gtfs < 0.85, // first to go
    serviceAlerts: gtfs < 0.92,
    xml: limiter.withinHeadroom("xml_api", now),
    intervalMultiplier: gtfs >= 0.95 ? 4 : gtfs >= 0.85 ? 2 : 1,
  };
}
