import type { Direction, TripStopEvent } from "@njt/shared";
import type { Database } from "../database";
import { fromSqlBool, toSqlBool } from "../json";

interface EventRow {
  trip_id: string;
  route_id: string;
  line_name: string;
  stop_id: string;
  stop_name: string;
  stop_sequence: number;
  direction: string;
  service_date: string;
  scheduled_arrival: number | null;
  scheduled_departure: number | null;
  observed_arrival: number | null;
  delay_seconds: number | null;
  stop_skipped: number;
  trip_cancelled: number;
  gtfs_static_version: string;
  ingested_at_ms: number;
}

/** Explicit column list for event reads (B5: no SELECT *); every column is
 * consumed by {@link toEvent} and the pipeline aggregator. */
const EVENT_COLUMNS =
  "trip_id, route_id, line_name, stop_id, stop_name, stop_sequence, direction, service_date, " +
  "scheduled_arrival, scheduled_departure, observed_arrival, delay_seconds, stop_skipped, " +
  "trip_cancelled, gtfs_static_version, ingested_at_ms";

function toEvent(row: EventRow): TripStopEvent {
  return {
    tripId: row.trip_id,
    routeId: row.route_id,
    lineName: row.line_name,
    stopId: row.stop_id,
    stopName: row.stop_name,
    stopSequence: row.stop_sequence,
    direction: row.direction as Direction,
    serviceDate: row.service_date,
    scheduledArrival: row.scheduled_arrival,
    scheduledDeparture: row.scheduled_departure,
    observedArrival: row.observed_arrival,
    delaySeconds: row.delay_seconds,
    stopSkipped: fromSqlBool(row.stop_skipped),
    tripCancelled: fromSqlBool(row.trip_cancelled),
    gtfsStaticVersion: row.gtfs_static_version,
    ingestedAtMs: row.ingested_at_ms,
  };
}

/**
 * Store of {@link TripStopEvent}s. `record` upserts on (trip, stop, service
 * date) and keeps the reading closest to the scheduled arrival as the
 * authoritative "final reading" (PRD deduplication rule), while always letting
 * a cancellation and the first non-null delay win.
 */
export class TripStopEventRepository {
  constructor(private readonly db: Database) {}

  private static readonly UPSERT = /* sql */ `
    INSERT INTO trip_stop_events (
      trip_id, route_id, line_name, stop_id, stop_name, stop_sequence, direction,
      service_date, scheduled_arrival, scheduled_departure, observed_arrival,
      delay_seconds, stop_skipped, trip_cancelled, gtfs_static_version, ingested_at_ms
    ) VALUES (
      :trip_id, :route_id, :line_name, :stop_id, :stop_name, :stop_sequence, :direction,
      :service_date, :scheduled_arrival, :scheduled_departure, :observed_arrival,
      :delay_seconds, :stop_skipped, :trip_cancelled, :gtfs_static_version, :ingested_at_ms
    )
    ON CONFLICT(trip_id, stop_id, service_date) DO UPDATE SET
      route_id            = excluded.route_id,
      line_name           = excluded.line_name,
      stop_name           = excluded.stop_name,
      stop_sequence       = excluded.stop_sequence,
      direction           = excluded.direction,
      scheduled_arrival   = excluded.scheduled_arrival,
      scheduled_departure = excluded.scheduled_departure,
      observed_arrival    = excluded.observed_arrival,
      delay_seconds       = excluded.delay_seconds,
      stop_skipped        = excluded.stop_skipped,
      trip_cancelled      = excluded.trip_cancelled,
      gtfs_static_version = excluded.gtfs_static_version,
      ingested_at_ms      = excluded.ingested_at_ms
    WHERE
      excluded.trip_cancelled = 1
      OR trip_stop_events.delay_seconds IS NULL
      OR excluded.scheduled_arrival IS NULL
      OR abs(excluded.ingested_at_ms - excluded.scheduled_arrival * 1000)
         < abs(trip_stop_events.ingested_at_ms - trip_stop_events.scheduled_arrival * 1000)
  `;

  private bind(event: TripStopEvent) {
    return {
      trip_id: event.tripId,
      route_id: event.routeId,
      line_name: event.lineName,
      stop_id: event.stopId,
      stop_name: event.stopName,
      stop_sequence: event.stopSequence,
      direction: event.direction,
      service_date: event.serviceDate,
      scheduled_arrival: event.scheduledArrival,
      scheduled_departure: event.scheduledDeparture,
      observed_arrival: event.observedArrival,
      delay_seconds: event.delaySeconds,
      stop_skipped: toSqlBool(event.stopSkipped),
      trip_cancelled: toSqlBool(event.tripCancelled),
      gtfs_static_version: event.gtfsStaticVersion,
      ingested_at_ms: event.ingestedAtMs,
    };
  }

  record(event: TripStopEvent): void {
    this.db.prepare(TripStopEventRepository.UPSERT).run(this.bind(event));
  }

  recordMany(events: readonly TripStopEvent[]): void {
    const stmt = this.db.prepare(TripStopEventRepository.UPSERT);
    this.db.transaction(() => {
      for (const event of events) stmt.run(this.bind(event));
    });
  }

  /** All events on a service date — used by the nightly aggregator. */
  getByServiceDate(serviceDate: string): TripStopEvent[] {
    return this.db
      .all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM trip_stop_events WHERE service_date = :d ORDER BY trip_id, stop_sequence`,
        { d: serviceDate },
      )
      .map(toEvent);
  }

  /** Bounded single-station query (inclusive date range), for station detail. */
  getByStop(stopId: string, from: string, to: string): TripStopEvent[] {
    return this.db
      .all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM trip_stop_events WHERE stop_id = :s AND service_date BETWEEN :from AND :to`,
        { s: stopId, from, to },
      )
      .map(toEvent);
  }

  /** Distinct service dates present, ascending. */
  serviceDates(): string[] {
    return this.db
      .all<{ service_date: string }>("SELECT DISTINCT service_date FROM trip_stop_events ORDER BY service_date")
      .map((r) => r.service_date);
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM trip_stop_events")?.c ?? 0;
  }

  /** Distinct route ids events are stored under, ascending. */
  distinctRouteIds(): string[] {
    return this.db
      .all<{ route_id: string }>("SELECT DISTINCT route_id FROM trip_stop_events ORDER BY route_id")
      .map((r) => r.route_id);
  }

  /** Service dates holding at least one event under a given route id. */
  serviceDatesForRouteId(routeId: string): string[] {
    return this.db
      .all<{ service_date: string }>(
        "SELECT DISTINCT service_date FROM trip_stop_events WHERE route_id = :r ORDER BY service_date",
        { r: routeId },
      )
      .map((r) => r.service_date);
  }

  /** Repoint events keyed by a malformed route id onto the right route + line. */
  relabelRouteId(staleRouteId: string, routeId: string, lineName: string): number {
    const affected =
      this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM trip_stop_events WHERE route_id = :stale", {
        stale: staleRouteId,
      })?.c ?? 0;
    this.db.run("UPDATE trip_stop_events SET route_id = :r, line_name = :n WHERE route_id = :stale", {
      r: routeId,
      n: lineName,
      stale: staleRouteId,
    });
    return affected;
  }

  /** Distinct line names events are stored under, ascending. */
  distinctLineNames(): string[] {
    return this.db
      .all<{ line_name: string }>("SELECT DISTINCT line_name FROM trip_stop_events ORDER BY line_name")
      .map((r) => r.line_name);
  }

  /** Service dates holding at least one event under a given line name. */
  serviceDatesForLineName(lineName: string): string[] {
    return this.db
      .all<{ service_date: string }>(
        "SELECT DISTINCT service_date FROM trip_stop_events WHERE line_name = :n ORDER BY service_date",
        { n: lineName },
      )
      .map((r) => r.service_date);
  }

  /**
   * Repoint events stored under a stale line name (historically the raw feed
   * `route_id`) onto the resolved line. `line_name` is not part of the primary
   * key, so this can't collide; callers must recompute the affected days.
   */
  relabelLineName(staleLineName: string, routeId: string, lineName: string): number {
    const affected =
      this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM trip_stop_events WHERE line_name = :stale", {
        stale: staleLineName,
      })?.c ?? 0;
    this.db.run("UPDATE trip_stop_events SET route_id = :r, line_name = :n WHERE line_name = :stale", {
      r: routeId,
      n: lineName,
      stale: staleLineName,
    });
    return affected;
  }
}
