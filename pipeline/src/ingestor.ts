import type { Repositories } from "@njt/db";
import { type FeedType, toLocalDateString } from "@njt/shared";
import { withRetry } from "./backoff";
import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import type { FeedClient } from "./feeds";
import { recomputeServiceDate } from "./aggregator";
import { loadGtfsStatic } from "./gtfs-static/load";
import { loadOfficialMetrics } from "./official/parse";
import { parseServiceAlerts, parseTripUpdates } from "./gtfs-rt/parse";
import { createScheduleContext } from "./gtfs-rt/schedule-context";
import { type Logger, consoleLogger } from "./logger";
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
 * Orchestrates a single poll of each feed: fetch (with retry) -> store raw
 * snapshot -> parse -> persist -> update health + budget. Never writes partial
 * records: a fully failed fetch records a failure and a gap, nothing else.
 */
export class Ingestor {
  private readonly repos: Repositories;
  private readonly client: FeedClient;
  private readonly config: PipelineConfig;
  private readonly rateLimiter: RateLimiter;
  private readonly clock: Clock;
  private readonly logger: Logger;

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

  /** Fetch with retry while counting every attempt against the GTFS-RT budget. */
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
    try {
      const bytes = await this.fetchCounting(() => this.client.fetchTripUpdates());
      this.repos.snapshots.insert({ feedType: "TripUpdates", fetchedAtMs: now, rawBytes: bytes });

      const ctx = createScheduleContext(this.repos.gtfs);
      const events = parseTripUpdates(bytes, ctx, {
        now,
        defaultServiceDate: this.serviceDate(now),
        gtfsStaticVersion: this.repos.gtfs.currentVersion()?.versionId ?? "unknown",
        onTripMismatch: (tripId) => this.logger.warn("trip id mismatch (RT not in static)", { tripId }),
      });
      this.repos.events.recordMany(events);

      this.recordGapIfResumed("TripUpdates", now);
      this.repos.health.recordSuccess("TripUpdates", now);
      this.repos.health.ensureCollectionStart(this.serviceDate(now));
      this.logger.info("TripUpdates ingested", { events: events.length });
      return true;
    } catch (error) {
      this.repos.health.recordFailure("TripUpdates", now);
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
      this.repos.health.recordFailure("ServiceAlerts", now);
      this.logger.error("ServiceAlerts poll failed", { error: String(error) });
      return false;
    }
  }

  async pollVehiclePositions(): Promise<boolean> {
    const now = this.clock.now();
    try {
      const bytes = await this.fetchCounting(() => this.client.fetchVehiclePositions());
      this.repos.snapshots.insert({ feedType: "VehiclePositions", fetchedAtMs: now, rawBytes: bytes });
      this.repos.health.recordSuccess("VehiclePositions", now);
      return true;
    } catch (error) {
      this.repos.health.recordFailure("VehiclePositions", now);
      this.logger.error("VehiclePositions poll failed", { error: String(error) });
      return false;
    }
  }

  /** Recompute today's aggregates (called hourly + after midnight rollover). */
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

  /** Record a gap when ingest resumes after a longer-than-expected silence. */
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
