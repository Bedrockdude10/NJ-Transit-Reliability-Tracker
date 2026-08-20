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

export interface TrainRun {
  serviceDate: string;
  delaySeconds: number | null;
  cancelled: boolean;
  skipped: boolean;
}

export interface TripIdentity {
  tripId: string;
  lineName: string;
  routeId: string;
  direction: Direction;
  originStopId: string;
  originStopName: string;
  terminalStopId: string;
  terminalStopName: string;
}

export interface LineArrival {
  tripId: string;
  observedArrival: number;
  delaySeconds: number;
}

export interface UpcomingDeparture {
  tripId: string;
  routeId: string;
  lineName: string;
  direction: Direction;
  stopSequence: number;
  scheduledArrival: number | null;
  scheduledDeparture: number | null;
  /** The feed's current prediction; null for a cancelled trip. */
  predictedArrival: number | null;
  delaySeconds: number | null;
  stopSkipped: boolean;
  tripCancelled: boolean;
  headsign: string | null;
  /** Ordering key: predicted, else scheduled departure, else scheduled arrival. */
  dueAt: number;
}

interface UpcomingDepartureRow {
  trip_id: string;
  route_id: string;
  line_name: string;
  direction: string;
  stop_sequence: number;
  scheduled_arrival: number | null;
  scheduled_departure: number | null;
  observed_arrival: number | null;
  delay_seconds: number | null;
  stop_skipped: number;
  trip_cancelled: number;
  trip_headsign: string | null;
  due_at: number;
}

export interface ObservedJourney {
  tripId: string;
  serviceDate: string;
  lineName: string;
  routeId: string;
  direction: Direction;
  scheduledDeparture: number | null;
  originDelaySeconds: number | null;
  scheduledArrival: number | null;
  destinationDelaySeconds: number | null;
  observedArrival: number | null;
  cancelled: boolean;
  skipped: boolean;
}

interface JourneyRow {
  trip_id: string;
  service_date: string;
  line_name: string;
  route_id: string;
  direction: string;
  sched_dep: number | null;
  sched_dep_arr: number | null;
  origin_delay: number | null;
  sched_arr: number | null;
  dest_delay: number | null;
  obs_arr: number | null;
  cancelled: number;
  skipped: number;
}

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
 * Mirrors the `WHERE` clause of `UPSERT` below; the two must agree, and
 * `events.upsert-parity.test.ts` holds them together.
 */
export function prefersIncomingReading(
  stored: Pick<TripStopEvent, "delaySeconds" | "scheduledArrival" | "ingestedAtMs">,
  incoming: Pick<TripStopEvent, "tripCancelled" | "scheduledArrival" | "ingestedAtMs">,
): boolean {
  if (incoming.tripCancelled) return true;
  if (stored.delaySeconds === null) return true;
  if (incoming.scheduledArrival === null) return true;
  if (stored.scheduledArrival === null) return false;
  const incomingDistance = Math.abs(incoming.ingestedAtMs - incoming.scheduledArrival * 1000);
  const storedDistance = Math.abs(stored.ingestedAtMs - stored.scheduledArrival * 1000);
  return incomingDistance < storedDistance;
}

export class TripStopEventRepository {
  constructor(private readonly db: Database) {}

  private static readonly WRITE = /* sql */ `
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
  `;

  /** Mirrored in {@link prefersIncomingReading} — change both together. */
  private static readonly UPSERT = `${TripStopEventRepository.WRITE}
    WHERE
      excluded.trip_cancelled = 1
      OR trip_stop_events.delay_seconds IS NULL
      OR excluded.scheduled_arrival IS NULL
      OR abs(excluded.ingested_at_ms - excluded.scheduled_arrival * 1000)
         < abs(trip_stop_events.ingested_at_ms - trip_stop_events.scheduled_arrival * 1000)
  `;

  private static readonly REPLACE = TripStopEventRepository.WRITE;

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

  /**
   * Unconditional overwrite, for replay only — the caller already arbitrated.
   * Live ingest must not use it: a parser fix changes values, not timings, so
   * the UPSERT guard would reject exactly the corrections a replay exists to make.
   */
  replaceMany(events: readonly TripStopEvent[]): void {
    const stmt = this.db.prepare(TripStopEventRepository.REPLACE);
    this.db.transaction(() => {
      for (const event of events) stmt.run(this.bind(event));
    });
  }

  getByServiceDate(serviceDate: string): TripStopEvent[] {
    return this.db
      .all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM trip_stop_events WHERE service_date = :d ORDER BY trip_id, stop_sequence`,
        { d: serviceDate },
      )
      .map(toEvent);
  }

  /** Inclusive date range. */
  getByStop(stopId: string, from: string, to: string): TripStopEvent[] {
    return this.db
      .all<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM trip_stop_events WHERE stop_id = :s AND service_date BETWEEN :from AND :to`,
        { s: stopId, from, to },
      )
      .map(toEvent);
  }

  /**
   * `observed_arrival` on a stop the train hasn't reached yet is the feed's
   * current prediction, not an observation. The fallback chain exists so
   * cancelled trips, which have no prediction, still take their scheduled slot.
   */
  upcomingAtStop(
    stopId: string,
    versionId: string | null,
    fromEpoch: number,
    toEpoch: number,
    limit: number,
  ): UpcomingDeparture[] {
    const rows = this.db.all<UpcomingDepartureRow>(
      /* sql */ `
        SELECT e.trip_id, e.route_id, e.line_name, e.direction, e.stop_sequence,
               e.scheduled_arrival, e.scheduled_departure, e.observed_arrival,
               e.delay_seconds, e.stop_skipped, e.trip_cancelled,
               t.trip_headsign,
               COALESCE(e.observed_arrival, e.scheduled_departure, e.scheduled_arrival) AS due_at
        FROM trip_stop_events e
        LEFT JOIN gtfs_trips t ON t.version_id = :v AND t.trip_id = e.trip_id
        WHERE e.stop_id = :s
          AND due_at BETWEEN :from AND :to
        ORDER BY due_at
        LIMIT :lim
      `,
      { s: stopId, v: versionId ?? "", from: fromEpoch, to: toEpoch, lim: limit },
    );
    return rows.map((r) => ({
      tripId: r.trip_id,
      routeId: r.route_id,
      lineName: r.line_name,
      direction: r.direction as Direction,
      stopSequence: r.stop_sequence,
      scheduledArrival: r.scheduled_arrival,
      scheduledDeparture: r.scheduled_departure,
      predictedArrival: r.observed_arrival,
      delaySeconds: r.delay_seconds,
      stopSkipped: fromSqlBool(r.stop_skipped),
      tripCancelled: fromSqlBool(r.trip_cancelled),
      headsign: r.trip_headsign,
      dueAt: r.due_at,
    }));
  }

  /** Bounded by the (stop_id, service_date) index at both ends. */
  journeysBetween(originStopId: string, destinationStopId: string, from: string, to: string): ObservedJourney[] {
    const rows = this.db.all<JourneyRow>(
      /* sql */ `
        SELECT o.trip_id, o.service_date, o.line_name, o.route_id, o.direction,
               o.scheduled_departure AS sched_dep, o.scheduled_arrival AS sched_dep_arr,
               o.delay_seconds AS origin_delay,
               d.scheduled_arrival AS sched_arr, d.delay_seconds AS dest_delay,
               d.observed_arrival AS obs_arr,
               (o.trip_cancelled OR d.trip_cancelled) AS cancelled,
               (o.stop_skipped OR d.stop_skipped) AS skipped
        FROM trip_stop_events o
        JOIN trip_stop_events d
          ON d.trip_id = o.trip_id AND d.service_date = o.service_date
        WHERE o.stop_id = :origin
          AND d.stop_id = :dest
          AND o.stop_sequence < d.stop_sequence
          AND o.service_date BETWEEN :from AND :to
        ORDER BY o.service_date, sched_dep
      `,
      { origin: originStopId, dest: destinationStopId, from, to },
    );
    return rows.map((r) => ({
      tripId: r.trip_id,
      serviceDate: r.service_date,
      lineName: r.line_name,
      routeId: r.route_id,
      direction: r.direction as Direction,
      scheduledDeparture: r.sched_dep ?? r.sched_dep_arr,
      originDelaySeconds: r.origin_delay,
      scheduledArrival: r.sched_arr,
      destinationDelaySeconds: r.dest_delay,
      observedArrival: r.obs_arr,
      cancelled: fromSqlBool(r.cancelled),
      skipped: fromSqlBool(r.skipped),
    }));
  }

  serviceDates(): string[] {
    return this.db
      .all<{ service_date: string }>("SELECT DISTINCT service_date FROM trip_stop_events ORDER BY service_date")
      .map((r) => r.service_date);
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM trip_stop_events")?.c ?? 0;
  }

  /**
   * Real NJT GTFS-RT trip ids are numeric (or empty); only the removed pre-API
   * seed ever minted `<LINE>-<direction>-<n>`, so this shape means "fabricated".
   */
  private static readonly SEED_PREDICATE =
    "(trip_id GLOB '*-inbound-*' OR trip_id GLOB '*-outbound-*')";

  countSeedEvents(): number {
    return (
      this.db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM trip_stop_events WHERE ${TripStopEventRepository.SEED_PREDICATE}`,
      )?.c ?? 0
    );
  }

  serviceDatesWithSeedEvents(): string[] {
    return this.db
      .all<{ service_date: string }>(
        `SELECT DISTINCT service_date FROM trip_stop_events WHERE ${TripStopEventRepository.SEED_PREDICATE} ORDER BY service_date`,
      )
      .map((r) => r.service_date);
  }

  /** Callers must recompute the affected dates. */
  deleteSeedEvents(): number {
    const affected = this.countSeedEvents();
    this.db.run(`DELETE FROM trip_stop_events WHERE ${TripStopEventRepository.SEED_PREDICATE}`);
    return affected;
  }

  earliestServiceDate(): string | null {
    return this.db.get<{ d: string | null }>("SELECT MIN(service_date) AS d FROM trip_stop_events")?.d ?? null;
  }

  distinctRouteIds(): string[] {
    return this.db
      .all<{ route_id: string }>("SELECT DISTINCT route_id FROM trip_stop_events ORDER BY route_id")
      .map((r) => r.route_id);
  }

  serviceDatesForRouteId(routeId: string): string[] {
    return this.db
      .all<{ service_date: string }>(
        "SELECT DISTINCT service_date FROM trip_stop_events WHERE route_id = :r ORDER BY service_date",
        { r: routeId },
      )
      .map((r) => r.service_date);
  }

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

  /**
   * One departure's outcome at one stop, per service date it ran. `tripId` is
   * stable across days — measured, 1,321 of 1,579 ids recur — which is what
   * makes a record possible at all. See README "Train record".
   */
  runsAtStop(tripId: string, stopId: string, from: string, to: string): TrainRun[] {
    return this.db
      .all<{
        service_date: string;
        delay_seconds: number | null;
        trip_cancelled: number;
        stop_skipped: number;
      }>(
        /* sql */ `
          SELECT service_date, delay_seconds, trip_cancelled, stop_skipped
          FROM trip_stop_events
          WHERE trip_id = :trip AND stop_id = :stop
            AND service_date BETWEEN :from AND :to
          ORDER BY service_date
        `,
        { trip: tripId, stop: stopId, from, to },
      )
      .map((r) => ({
        serviceDate: r.service_date,
        delaySeconds: r.delay_seconds,
        cancelled: fromSqlBool(r.trip_cancelled),
        skipped: fromSqlBool(r.stop_skipped),
      }));
  }

  /** How a screen names a departure: its line, and where it runs from and to. */
  tripIdentity(tripId: string): TripIdentity | null {
    const row = this.db.get<{
      line_name: string;
      route_id: string;
      direction: string;
      origin_stop_id: string;
      origin_stop_name: string;
      terminal_stop_id: string;
      terminal_stop_name: string;
    }>(
      /* sql */ `
        SELECT line_name, route_id, direction,
               first_value(stop_id)   OVER seq AS origin_stop_id,
               first_value(stop_name) OVER seq AS origin_stop_name,
               last_value(stop_id)    OVER seq AS terminal_stop_id,
               last_value(stop_name)  OVER seq AS terminal_stop_name
        FROM trip_stop_events
        WHERE trip_id = :trip
        WINDOW seq AS (
          ORDER BY stop_sequence
          RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )
        LIMIT 1
      `,
      { trip: tripId },
    );
    if (!row) return null;
    return {
      tripId,
      lineName: row.line_name,
      routeId: row.route_id,
      direction: row.direction as Direction,
      originStopId: row.origin_stop_id,
      originStopName: row.origin_stop_name,
      terminalStopId: row.terminal_stop_id,
      terminalStopName: row.terminal_stop_name,
    };
  }

  /**
   * Every arrival a line actually made on one date. Banding by local hour is the
   * caller's job: SQLite would need a fixed UTC offset and get DST wrong.
   */
  arrivalsOnDate(lineName: string, serviceDate: string): LineArrival[] {
    return this.db
      .all<{ trip_id: string; observed_arrival: number; delay_seconds: number }>(
        /* sql */ `
          SELECT trip_id, observed_arrival, delay_seconds
          FROM trip_stop_events
          WHERE line_name = :line AND service_date = :date
            AND observed_arrival IS NOT NULL
            AND delay_seconds IS NOT NULL
            AND stop_skipped = 0
          ORDER BY observed_arrival
        `,
        { line: lineName, date: serviceDate },
      )
      .map((r) => ({
        tripId: r.trip_id,
        observedArrival: r.observed_arrival,
        delaySeconds: r.delay_seconds,
      }));
  }

  lineNamesOnDate(serviceDate: string): string[] {
    return this.db
      .all<{ line_name: string }>(
        "SELECT DISTINCT line_name FROM trip_stop_events WHERE service_date = :date ORDER BY line_name",
        { date: serviceDate },
      )
      .map((r) => r.line_name);
  }

  distinctLineNames(): string[] {
    return this.db
      .all<{ line_name: string }>("SELECT DISTINCT line_name FROM trip_stop_events ORDER BY line_name")
      .map((r) => r.line_name);
  }

  serviceDatesForLineName(lineName: string): string[] {
    return this.db
      .all<{ service_date: string }>(
        "SELECT DISTINCT service_date FROM trip_stop_events WHERE line_name = :n ORDER BY service_date",
        { n: lineName },
      )
      .map((r) => r.service_date);
  }

  /**
   * `line_name` is not part of the primary key, so this can't collide; callers
   * must recompute the affected days.
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
