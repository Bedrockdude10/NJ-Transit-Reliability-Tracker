import type {
  ConnectionDailyRow,
  DelayDistributionDailyRow,
  Direction,
  DirectionFilter,
  HeatmapDailyRow,
  HeatmapType,
  OtpDailyRow,
  ScopeKind,
  StationDailyRow,
  StationDistributionDailyRow,
  StationHourlyRow,
  TripDailyRow,
} from "@njt/shared";
import type { Database } from "../database";
import { parseCountMap, parseJson, serializeJson } from "../json";

// --- SQL-aggregated read shapes ---------------------------------------------

export interface HeatmapBucketAgg {
  bucket: number;
  sumDelaySeconds: number;
  observations: number;
}
export interface WorstTripAgg {
  tripId: string;
  routeId: string;
  lineName: string;
  direction: Direction;
  terminalStopName: string;
  avgTerminalDelaySeconds: number;
  observations: number;
}
export interface StationLineDirAgg {
  lineName: string;
  direction: Direction;
  sumArrivalDelaySeconds: number;
  observations: number;
}
export interface StationHourAgg {
  hour: number;
  sumDelaySeconds: number;
  observations: number;
}
export interface StationAmplificationAgg {
  arrivedWithin5Min: number;
  departedLateAfterOnTimeArrival: number;
}
export interface ConnectionTripleAgg {
  inboundTripId: string;
  transferStopId: string;
  outboundTripId: string;
  observations: number;
}

/**
 * Read/write access to the pre-computed daily aggregate tables. Writers are
 * used by the pipeline's aggregator; readers are used by the API, which sums
 * the small daily rows over a requested range (never the raw event table).
 */
export class AggregateRepository {
  constructor(private readonly db: Database) {}

  /** Delete every aggregate row for a service date, so it can be recomputed. */
  clearServiceDate(serviceDate: string): void {
    const tables = [
      "otp_aggregates",
      "delay_distribution_aggregates",
      "heatmap_aggregates",
      "trip_daily_aggregates",
      "station_daily_aggregates",
      "station_hourly_aggregates",
      "station_distribution_aggregates",
      "connection_aggregates",
    ];
    this.db.transaction(() => {
      for (const table of tables) {
        this.db.prepare(`DELETE FROM ${table} WHERE service_date = :d`).run({ d: serviceDate });
      }
    });
  }

  // --- OTP -------------------------------------------------------------------

  upsertOtpDaily(row: OtpDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO otp_aggregates
          (scope, scope_id, service_date, direction, trips_operated, trips_cancelled, on_time_counts, sum_delay_seconds)
        VALUES (:scope, :scopeId, :date, :dir, :operated, :cancelled, :counts, :sum)
        ON CONFLICT(scope, scope_id, service_date, direction) DO UPDATE SET
          trips_operated=excluded.trips_operated, trips_cancelled=excluded.trips_cancelled,
          on_time_counts=excluded.on_time_counts, sum_delay_seconds=excluded.sum_delay_seconds
      `,
      )
      .run({
        scope: row.scope,
        scopeId: row.scopeId,
        date: row.serviceDate,
        dir: row.direction,
        operated: row.tripsOperated,
        cancelled: row.tripsCancelled,
        counts: serializeJson(row.onTimeCounts),
        sum: row.sumDelaySeconds,
      });
  }

  getOtpDailyRows(
    scope: ScopeKind,
    scopeId: string,
    direction: DirectionFilter,
    from: string,
    to: string,
  ): OtpDailyRow[] {
    return this.db
      .all<{
        scope: string;
        scope_id: string;
        service_date: string;
        direction: string;
        trips_operated: number;
        trips_cancelled: number;
        on_time_counts: string;
        sum_delay_seconds: number;
      }>(
        "SELECT * FROM otp_aggregates WHERE scope=:scope AND scope_id=:scopeId AND direction=:dir AND service_date BETWEEN :from AND :to ORDER BY service_date",
        { scope, scopeId, dir: direction, from, to },
      )
      .map((row) => ({
        scope: row.scope as ScopeKind,
        scopeId: row.scope_id,
        serviceDate: row.service_date,
        direction: row.direction as DirectionFilter,
        tripsOperated: row.trips_operated,
        tripsCancelled: row.trips_cancelled,
        onTimeCounts: parseCountMap(row.on_time_counts),
        sumDelaySeconds: row.sum_delay_seconds,
      }));
  }

  // --- Delay distribution ----------------------------------------------------

  upsertDelayDistributionDaily(row: DelayDistributionDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO delay_distribution_aggregates (scope, scope_id, service_date, counts)
        VALUES (:scope, :scopeId, :date, :counts)
        ON CONFLICT(scope, scope_id, service_date) DO UPDATE SET counts=excluded.counts
      `,
      )
      .run({ scope: row.scope, scopeId: row.scopeId, date: row.serviceDate, counts: serializeJson(row.counts) });
  }

  getDelayDistributionDailyRows(
    scope: ScopeKind,
    scopeId: string,
    from: string,
    to: string,
  ): DelayDistributionDailyRow[] {
    return this.db
      .all<{ scope: string; scope_id: string; service_date: string; counts: string }>(
        "SELECT * FROM delay_distribution_aggregates WHERE scope=:scope AND scope_id=:scopeId AND service_date BETWEEN :from AND :to ORDER BY service_date",
        { scope, scopeId, from, to },
      )
      .map((row) => ({
        scope: row.scope as ScopeKind,
        scopeId: row.scope_id,
        serviceDate: row.service_date,
        counts: parseCountMap(row.counts),
      }));
  }

  // --- Heatmap ---------------------------------------------------------------

  upsertHeatmapDaily(row: HeatmapDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO heatmap_aggregates (scope, scope_id, type, bucket, service_date, sum_delay_seconds, observations)
        VALUES (:scope, :scopeId, :type, :bucket, :date, :sum, :obs)
        ON CONFLICT(scope, scope_id, type, bucket, service_date) DO UPDATE SET
          sum_delay_seconds=excluded.sum_delay_seconds, observations=excluded.observations
      `,
      )
      .run({
        scope: row.scope,
        scopeId: row.scopeId,
        type: row.type,
        bucket: row.bucket,
        date: row.serviceDate,
        sum: row.sumDelaySeconds,
        obs: row.observations,
      });
  }

  sumHeatmap(
    scope: ScopeKind,
    scopeId: string,
    type: HeatmapType,
    from: string,
    to: string,
  ): HeatmapBucketAgg[] {
    return this.db.all<HeatmapBucketAgg>(
      /* sql */ `
        SELECT bucket, SUM(sum_delay_seconds) AS sumDelaySeconds, SUM(observations) AS observations
        FROM heatmap_aggregates
        WHERE scope=:scope AND scope_id=:scopeId AND type=:type AND service_date BETWEEN :from AND :to
        GROUP BY bucket ORDER BY bucket
      `,
      { scope, scopeId, type, from, to },
    );
  }

  // --- Trip daily (worst trips) ----------------------------------------------

  upsertTripDaily(row: TripDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO trip_daily_aggregates
          (trip_id, service_date, route_id, line_name, direction, terminal_stop_name, terminal_delay_seconds)
        VALUES (:trip, :date, :route, :line, :dir, :terminal, :delay)
        ON CONFLICT(trip_id, service_date) DO UPDATE SET
          route_id=excluded.route_id, line_name=excluded.line_name, direction=excluded.direction,
          terminal_stop_name=excluded.terminal_stop_name, terminal_delay_seconds=excluded.terminal_delay_seconds
      `,
      )
      .run({
        trip: row.tripId,
        date: row.serviceDate,
        route: row.routeId,
        line: row.lineName,
        dir: row.direction,
        terminal: row.terminalStopName,
        delay: row.terminalDelaySeconds,
      });
  }

  worstTripsForRoute(routeId: string, from: string, to: string, limit: number): WorstTripAgg[] {
    return this.db.all<WorstTripAgg>(
      /* sql */ `
        SELECT trip_id AS tripId, route_id AS routeId, line_name AS lineName, direction,
               terminal_stop_name AS terminalStopName,
               AVG(terminal_delay_seconds) AS avgTerminalDelaySeconds,
               COUNT(*) AS observations
        FROM trip_daily_aggregates
        WHERE route_id=:route AND service_date BETWEEN :from AND :to AND terminal_delay_seconds IS NOT NULL
        GROUP BY trip_id
        ORDER BY avgTerminalDelaySeconds DESC
        LIMIT :limit
      `,
      { route: routeId, from, to, limit },
    );
  }

  // --- Station daily ---------------------------------------------------------

  upsertStationDaily(row: StationDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO station_daily_aggregates
          (stop_id, service_date, line_name, direction, sum_arrival_delay_seconds, observations,
           arrived_within_5min, departed_late_after_on_time_arrival)
        VALUES (:stop, :date, :line, :dir, :sum, :obs, :within5, :late)
        ON CONFLICT(stop_id, service_date, line_name, direction) DO UPDATE SET
          sum_arrival_delay_seconds=excluded.sum_arrival_delay_seconds, observations=excluded.observations,
          arrived_within_5min=excluded.arrived_within_5min,
          departed_late_after_on_time_arrival=excluded.departed_late_after_on_time_arrival
      `,
      )
      .run({
        stop: row.stopId,
        date: row.serviceDate,
        line: row.lineName,
        dir: row.direction,
        sum: row.sumArrivalDelaySeconds,
        obs: row.observations,
        within5: row.arrivedWithin5Min,
        late: row.departedLateAfterOnTimeArrival,
      });
  }

  stationByLineDirection(stopId: string, from: string, to: string): StationLineDirAgg[] {
    return this.db.all<StationLineDirAgg>(
      /* sql */ `
        SELECT line_name AS lineName, direction,
               SUM(sum_arrival_delay_seconds) AS sumArrivalDelaySeconds,
               SUM(observations) AS observations
        FROM station_daily_aggregates
        WHERE stop_id=:stop AND service_date BETWEEN :from AND :to
        GROUP BY line_name, direction ORDER BY line_name, direction
      `,
      { stop: stopId, from, to },
    );
  }

  stationAmplification(stopId: string, from: string, to: string): StationAmplificationAgg {
    return (
      this.db.get<StationAmplificationAgg>(
        /* sql */ `
        SELECT COALESCE(SUM(arrived_within_5min),0) AS arrivedWithin5Min,
               COALESCE(SUM(departed_late_after_on_time_arrival),0) AS departedLateAfterOnTimeArrival
        FROM station_daily_aggregates
        WHERE stop_id=:stop AND service_date BETWEEN :from AND :to
      `,
        { stop: stopId, from, to },
      ) ?? { arrivedWithin5Min: 0, departedLateAfterOnTimeArrival: 0 }
    );
  }

  // --- Station hourly --------------------------------------------------------

  upsertStationHourly(row: StationHourlyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO station_hourly_aggregates (stop_id, service_date, hour, sum_delay_seconds, observations)
        VALUES (:stop, :date, :hour, :sum, :obs)
        ON CONFLICT(stop_id, service_date, hour) DO UPDATE SET
          sum_delay_seconds=excluded.sum_delay_seconds, observations=excluded.observations
      `,
      )
      .run({ stop: row.stopId, date: row.serviceDate, hour: row.hour, sum: row.sumDelaySeconds, obs: row.observations });
  }

  stationHourly(stopId: string, from: string, to: string): StationHourAgg[] {
    return this.db.all<StationHourAgg>(
      /* sql */ `
        SELECT hour, SUM(sum_delay_seconds) AS sumDelaySeconds, SUM(observations) AS observations
        FROM station_hourly_aggregates
        WHERE stop_id=:stop AND service_date BETWEEN :from AND :to
        GROUP BY hour ORDER BY hour
      `,
      { stop: stopId, from, to },
    );
  }

  // --- Station distribution --------------------------------------------------

  upsertStationDistributionDaily(row: StationDistributionDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO station_distribution_aggregates (stop_id, service_date, counts)
        VALUES (:stop, :date, :counts)
        ON CONFLICT(stop_id, service_date) DO UPDATE SET counts=excluded.counts
      `,
      )
      .run({ stop: row.stopId, date: row.serviceDate, counts: serializeJson(row.counts) });
  }

  getStationDistributionRows(stopId: string, from: string, to: string): StationDistributionDailyRow[] {
    return this.db
      .all<{ stop_id: string; service_date: string; counts: string }>(
        "SELECT * FROM station_distribution_aggregates WHERE stop_id=:stop AND service_date BETWEEN :from AND :to ORDER BY service_date",
        { stop: stopId, from, to },
      )
      .map((row) => ({ stopId: row.stop_id, serviceDate: row.service_date, counts: parseCountMap(row.counts) }));
  }

  // --- Connections -----------------------------------------------------------

  upsertConnectionDaily(row: ConnectionDailyRow): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO connection_aggregates
          (inbound_trip_id, transfer_stop_id, outbound_trip_id, service_date, observations, successes,
           peak_observations, peak_successes, off_peak_observations, off_peak_successes,
           by_day_of_week, inbound_delay_distribution)
        VALUES (:inbound, :transfer, :outbound, :date, :obs, :succ,
                :peakObs, :peakSucc, :offObs, :offSucc, :byDow, :dist)
        ON CONFLICT(inbound_trip_id, transfer_stop_id, outbound_trip_id, service_date) DO UPDATE SET
          observations=excluded.observations, successes=excluded.successes,
          peak_observations=excluded.peak_observations, peak_successes=excluded.peak_successes,
          off_peak_observations=excluded.off_peak_observations, off_peak_successes=excluded.off_peak_successes,
          by_day_of_week=excluded.by_day_of_week, inbound_delay_distribution=excluded.inbound_delay_distribution
      `,
      )
      .run({
        inbound: row.inboundTripId,
        transfer: row.transferStopId,
        outbound: row.outboundTripId,
        date: row.serviceDate,
        obs: row.observations,
        succ: row.successes,
        peakObs: row.peakObservations,
        peakSucc: row.peakSuccesses,
        offObs: row.offPeakObservations,
        offSucc: row.offPeakSuccesses,
        byDow: serializeJson(row.byDayOfWeek),
        dist: serializeJson(row.inboundDelayDistribution),
      });
  }

  getConnectionRows(
    inboundTripId: string,
    transferStopId: string,
    outboundTripId: string,
    from: string,
    to: string,
  ): ConnectionDailyRow[] {
    return this.db
      .all<{
        inbound_trip_id: string;
        transfer_stop_id: string;
        outbound_trip_id: string;
        service_date: string;
        observations: number;
        successes: number;
        peak_observations: number;
        peak_successes: number;
        off_peak_observations: number;
        off_peak_successes: number;
        by_day_of_week: string;
        inbound_delay_distribution: string;
      }>(
        /* sql */ `
        SELECT * FROM connection_aggregates
        WHERE inbound_trip_id=:inbound AND transfer_stop_id=:transfer AND outbound_trip_id=:outbound
          AND service_date BETWEEN :from AND :to
        ORDER BY service_date
      `,
        { inbound: inboundTripId, transfer: transferStopId, outbound: outboundTripId, from, to },
      )
      .map((row) => ({
        inboundTripId: row.inbound_trip_id,
        transferStopId: row.transfer_stop_id,
        outboundTripId: row.outbound_trip_id,
        serviceDate: row.service_date,
        observations: row.observations,
        successes: row.successes,
        peakObservations: row.peak_observations,
        peakSuccesses: row.peak_successes,
        offPeakObservations: row.off_peak_observations,
        offPeakSuccesses: row.off_peak_successes,
        byDayOfWeek: parseJson<ConnectionDailyRow["byDayOfWeek"]>(row.by_day_of_week),
        inboundDelayDistribution: parseCountMap(row.inbound_delay_distribution),
      }));
  }

  /**
   * Highest-frequency transfer triples over a service-date window (PRD success
   * criterion #4). The window bounds the GROUP BY so cost doesn't grow
   * unbounded with accumulated history.
   */
  topConnectionTriples(limit: number, from: string, to: string): ConnectionTripleAgg[] {
    return this.db.all<ConnectionTripleAgg>(
      /* sql */ `
        SELECT inbound_trip_id AS inboundTripId, transfer_stop_id AS transferStopId,
               outbound_trip_id AS outboundTripId, SUM(observations) AS observations
        FROM connection_aggregates
        WHERE service_date BETWEEN :from AND :to
        GROUP BY inbound_trip_id, transfer_stop_id, outbound_trip_id
        ORDER BY observations DESC
        LIMIT :limit
      `,
      { limit, from, to },
    );
  }
}
