import type { Repositories } from "@njt/db";
import { type FeedType, toLocalDateString } from "@njt/shared";
import { withRetry } from "./backoff";
import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import type { FeedClient } from "./feeds";
import { recomputeServiceDate } from "./aggregator";
import { loadGtfsStatic } from "./gtfs-static/load";
import { loadOfficialMetrics } from "./official/parse";
import { parseServiceAlerts, parseTripUpdates, parseVehiclePositions } from "./gtfs-rt/parse";
import { createScheduleCache, createScheduleContext, type ScheduleCache } from "./gtfs-rt/schedule-context";
import { type Logger, consoleLogger } from "@njt/shared/logger";
import { type RateLimiter } from "./rate-limiter";

export interface IngestorDeps {
  repos: Repositories;
  client: FeedClient;
  config: PipelineConfig;
  rateLimiter: RateLimiter;
  clock?: Clock;
  logger?: Logger;
}

const RETRY = { retries: 3, baseDelayMs: 500, maxDelayMs: 5_000 };

/**
 * One poll per feed: fetch (with retry) → store raw snapshot → parse → persist →
 * update health + budget. A failed fetch writes a failure and a gap, nothing partial.
 */
export class Ingestor {
  private readonly repos: Repositories;
  private readonly client: FeedClient;
  private readonly config: PipelineConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly clock: Clock;
  private readonly logger: Logger;
  /** Persistent schedule cache reused across polls; invalidates on version rollover. */
  private readonly scheduleCache: ScheduleCache = createScheduleCache();

  constructor(deps: IngestorDeps) {
    this.repos = deps.repos;
    this.client = deps.client;
    this.config = deps.config;
    this.rateLimiter = deps.rateLimiter;
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger ?? consoleLogger;
  }

  private serviceDate(now: number): string {
    return toLocalDateString(Math.floor(now / 1000));
  }

  /**
   * Never throws. `recordFailure` is itself a write, so under contention it can raise
   * SQLITE_BUSY from inside the catch block, rejecting the tick and killing the
   * process. The next tick is 30s away and recovers on its own.
   */
  private recordFailureSafely(feed: FeedType, now: number): void {
    try {
      this.repos.health.recordFailure(feed, now);
    } catch (error) {
      this.logger.error("could not record feed failure", { feed, error: String(error) });
    }
  }

  private async fetchCounting(fetchOnce: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const now = this.clock.now();
    let attempts = 0;
    try {
      return await withRetry(
        () => {
          attempts++;
          return fetchOnce();
        },
        { ...RETRY, clock: this.clock },
      );
    } finally {
      this.rateLimiter.record("gtfs_rt", attempts, now);
    }
  }

  async pollTripUpdates(): Promise<boolean> {
    const now = this.clock.now();
    const serviceDate = this.serviceDate(now);
    try {
      const bytes = await this.fetchCounting(() => this.client.fetchTripUpdates());
      this.repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: now, rawBytes: bytes });

      const ctx = createScheduleContext(this.repos.gtfs, this.scheduleCache);
      const events = parseTripUpdates(bytes, ctx, {
        now,
        defaultServiceDate: serviceDate,
        gtfsStaticVersion: this.repos.gtfs.currentVersion()?.versionId ?? "unknown",
        onTripMismatch: (tripId) => this.logger.warn("trip id mismatch (RT not in static)", { tripId }),
      });
      this.repos.events.recordMany(events);

      this.recordGapIfResumed("TripUpdates", now);
      this.repos.health.recordSuccess("TripUpdates", now);
      this.repos.health.ensureCollectionStart(serviceDate);
      this.logger.info("TripUpdates ingested", { events: events.length });
      return true;
    } catch (error) {
      this.recordFailureSafely("TripUpdates", now);
      this.logger.error("TripUpdates poll failed", { error: String(error) });
      return false;
    }
  }

  async pollServiceAlerts(): Promise<boolean> {
    const now = this.clock.now();
    try {
      const bytes = await this.fetchCounting(() => this.client.fetchServiceAlerts());
      this.repos.snapshots.insert({ feedType: "ServiceAlerts", fetchedAtMs: now, rawBytes: bytes });
      const alerts = parseServiceAlerts(bytes, { now });
      for (const alert of alerts) this.repos.alerts.upsert(alert);
      this.repos.health.recordSuccess("ServiceAlerts", now);
      this.logger.info("ServiceAlerts ingested", { alerts: alerts.length });
      return true;
    } catch (error) {
      this.recordFailureSafely("ServiceAlerts", now);
      this.logger.error("ServiceAlerts poll failed", { error: String(error) });
      return false;
    }
  }

  async pollVehiclePositions(): Promise<boolean> {
    const now = this.clock.now();
    try {
      const bytes = await this.fetchCounting(() => this.client.fetchVehiclePositions());
      this.repos.snapshots.insert({ feedType: "VehiclePositions", fetchedAtMs: now, rawBytes: bytes });

      // Each poll is a complete snapshot, so swap the set wholesale — trains that
      // stopped reporting must drop off the map.
      const ctx = createScheduleContext(this.repos.gtfs, this.scheduleCache);
      const positions = parseVehiclePositions(bytes, ctx, { now, defaultServiceDate: this.serviceDate(now) });
      this.repos.vehicles.replaceAll(positions);

      this.repos.health.recordSuccess("VehiclePositions", now);
      this.logger.info("VehiclePositions ingested", { vehicles: positions.length });
      return true;
    } catch (error) {
      this.recordFailureSafely("VehiclePositions", now);
      this.logger.error("VehiclePositions poll failed", { error: String(error) });
      return false;
    }
  }

  recompute(serviceDate: string = this.serviceDate(this.clock.now())): void {
    recomputeServiceDate(this.repos, serviceDate);
    this.logger.info("aggregates recomputed", { serviceDate });
  }

  syncGtfsStatic(zip: Uint8Array): void {
    const result = loadGtfsStatic(this.repos, zip, this.clock.now());
    this.logger.info("GTFS static synced", { ...result });
  }

  importOfficialMetrics(csv: string): number {
    const count = loadOfficialMetrics(this.repos, csv);
    this.logger.info("official metrics imported", { count });
    return count;
  }

  private lastSuccessMs(feed: FeedType): number | null {
    return this.repos.health.feedHealth().find((f) => f.feedType === feed)?.lastSuccessAtMs ?? null;
  }

  private recordGapIfResumed(feed: FeedType, now: number): void {
    const prior = this.lastSuccessMs(feed);
    const gapThreshold = this.config.intervals.tripUpdatesMs * 5;
    if (prior !== null && now - prior > gapThreshold) {
      this.repos.health.recordGap(feed, prior, now);
      this.logger.warn("data gap recorded", { feed, fromMs: prior, toMs: now });
    }
  }

  /** Alert (and record a gap) if TripUpdates has been silent too long. */
  async checkStaleness(): Promise<boolean> {
    const now = this.clock.now();
    const last = this.lastSuccessMs("TripUpdates");
    if (last === null || now - last <= this.config.noTripUpdatesAlertMs) return false;

    this.logger.error("no TripUpdates ingest within alert window", { lastSuccessMs: last, now });
    if (this.config.alertWebhookUrl) {
      try {
        await fetch(this.config.alertWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "NJT pipeline: no TripUpdates ingest in over an hour." }),
        });
      } catch (error) {
        this.logger.error("failed to send staleness webhook", { error: String(error) });
      }
    }
    return true;
  }
}
