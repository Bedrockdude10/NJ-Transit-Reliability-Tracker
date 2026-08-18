import type { Direction, VehiclePosition, VehicleStopStatus } from "@njt/shared";
import type { Database } from "../database";

interface VehicleRow {
  vehicle_id: string;
  trip_id: string | null;
  route_id: string | null;
  line_name: string | null;
  direction: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed_mps: number | null;
  stop_id: string | null;
  stop_name: string | null;
  status: string | null;
  reported_at: number | null;
  ingested_at_ms: number;
}

function toPosition(row: VehicleRow): VehiclePosition {
  return {
    vehicleId: row.vehicle_id,
    tripId: row.trip_id,
    routeId: row.route_id,
    lineName: row.line_name,
    direction: (row.direction as Direction | null) ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    bearing: row.bearing,
    speedMetersPerSecond: row.speed_mps,
    stopId: row.stop_id,
    stopName: row.stop_name,
    status: (row.status as VehicleStopStatus | null) ?? null,
    reportedAt: row.reported_at,
    ingestedAtMs: row.ingested_at_ms,
  };
}

/**
 * The VehiclePositions feed returns every active vehicle on each poll, so this
 * table is replaced wholesale rather than appended to — a train that stops
 * reporting disappears instead of lingering at a stale position.
 */
export class VehiclePositionRepository {
  constructor(private readonly db: Database) {}

  replaceAll(positions: readonly VehiclePosition[]): void {
    const stmt = this.db.prepare(
      /* sql */ `
        INSERT INTO vehicle_positions
          (vehicle_id, trip_id, route_id, line_name, direction, latitude, longitude,
           bearing, speed_mps, stop_id, stop_name, status, reported_at, ingested_at_ms)
        VALUES (:v, :t, :r, :n, :d, :lat, :lon, :b, :sp, :sid, :sn, :st, :ra, :ms)
      `,
    );
    this.db.transaction(() => {
      this.db.run("DELETE FROM vehicle_positions");
      for (const p of positions) {
        stmt.run({
          v: p.vehicleId,
          t: p.tripId ?? null,
          r: p.routeId ?? null,
          n: p.lineName ?? null,
          d: p.direction ?? null,
          lat: p.latitude,
          lon: p.longitude,
          b: p.bearing ?? null,
          sp: p.speedMetersPerSecond ?? null,
          sid: p.stopId ?? null,
          sn: p.stopName ?? null,
          st: p.status ?? null,
          ra: p.reportedAt ?? null,
          ms: p.ingestedAtMs,
        });
      }
    });
  }

  all(routeId?: string): VehiclePosition[] {
    const rows = routeId
      ? this.db.all<VehicleRow>("SELECT * FROM vehicle_positions WHERE route_id = :r ORDER BY vehicle_id", { r: routeId })
      : this.db.all<VehicleRow>("SELECT * FROM vehicle_positions ORDER BY vehicle_id");
    return rows.map(toPosition);
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM vehicle_positions")?.c ?? 0;
  }
}
