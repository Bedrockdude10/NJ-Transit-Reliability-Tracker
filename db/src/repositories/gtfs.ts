import type { GtfsStaticVersion } from "@njt/shared";
import type { Database } from "../database";

export type RouteMode = "rail" | "light_rail";
export interface GtfsRouteRecord {
  routeId: string;
  lineName: string;
  color?: string | null;
  mode?: RouteMode;
}
export interface GtfsStopCoord {
  stopId: string;
  stopName: string;
  lat: number | null;
  lon: number | null;
}
export interface GtfsStopRecord {
  stopId: string;
  stopName: string;
  stopLat?: number | null;
  stopLon?: number | null;
}
export interface GtfsTripRecord {
  tripId: string;
  routeId: string;
  serviceId?: string | null;
  directionId?: number | null;
  tripHeadsign?: string | null;
}
export interface GtfsRouteAliasRecord {
  sourceRouteId: string;
  canonicalRouteId: string;
}
export interface GtfsStopTimeRecord {
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime?: string | null;
  departureTime?: string | null;
}
export interface StationWithLines {
  stopId: string;
  stopName: string;
  lines: string[];
}

interface VersionRow {
  version_id: string;
  effective_from: number;
  effective_to: number | null;
  checksum: string;
  ingested_at_ms: number;
}

function toVersion(row: VersionRow): GtfsStaticVersion {
  return {
    versionId: row.version_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    checksum: row.checksum,
    ingestedAtMs: row.ingested_at_ms,
  };
}

export class GtfsRepository {
  constructor(private readonly db: Database) {}

  insertVersion(version: GtfsStaticVersion): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO gtfs_static_versions (version_id, effective_from, effective_to, checksum, ingested_at_ms)
        VALUES (:id, :from, :to, :checksum, :ms)
        ON CONFLICT(version_id) DO UPDATE SET
          effective_from = excluded.effective_from,
          effective_to   = excluded.effective_to,
          checksum       = excluded.checksum
      `,
      )
      .run({
        id: version.versionId,
        from: version.effectiveFrom,
        to: version.effectiveTo,
        checksum: version.checksum,
        ms: version.ingestedAtMs,
      });
  }

  /** `atSeconds` is epoch seconds. */
  supersede(versionId: string, atSeconds: number): void {
    this.db
      .prepare("UPDATE gtfs_static_versions SET effective_to = :at WHERE version_id = :id")
      .run({ at: atSeconds, id: versionId });
  }

  currentVersion(): GtfsStaticVersion | null {
    const row = this.db.get<VersionRow>("SELECT * FROM gtfs_static_versions ORDER BY effective_from DESC LIMIT 1");
    return row ? toVersion(row) : null;
  }

  allVersions(): GtfsStaticVersion[] {
    return this.db
      .all<VersionRow>("SELECT * FROM gtfs_static_versions ORDER BY effective_from")
      .map(toVersion);
  }

  findByChecksum(checksum: string): GtfsStaticVersion | null {
    const row = this.db.get<VersionRow>("SELECT * FROM gtfs_static_versions WHERE checksum = :c LIMIT 1", {
      c: checksum,
    });
    return row ? toVersion(row) : null;
  }

  storeFile(versionId: string, filename: string, content: Uint8Array): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO gtfs_static_files (version_id, filename, content) VALUES (:v, :f, :c)",
      )
      .run({ v: versionId, f: filename, c: content });
  }

  replaceRoutes(versionId: string, routes: readonly GtfsRouteRecord[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO gtfs_routes (version_id, route_id, line_name, route_color, route_mode) VALUES (:v, :r, :n, :c, :m)",
    );
    this.db.transaction(() => {
      for (const r of routes) stmt.run({ v: versionId, r: r.routeId, n: r.lineName, c: r.color ?? null, m: r.mode ?? "rail" });
    });
  }

  readFile(versionId: string, filename: string): Uint8Array | null {
    const row = this.db.get<{ content: Uint8Array }>(
      "SELECT content FROM gtfs_static_files WHERE version_id = :v AND filename = :f",
      { v: versionId, f: filename },
    );
    return row?.content ?? null;
  }

  replaceRouteAliases(versionId: string, aliases: readonly GtfsRouteAliasRecord[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO gtfs_route_aliases (version_id, source_route_id, canonical_route_id) VALUES (:v, :s, :c)",
    );
    this.db.transaction(() => {
      for (const a of aliases) stmt.run({ v: versionId, s: a.sourceRouteId, c: a.canonicalRouteId });
    });
  }

  /**
   * A replay must parse each snapshot against the schedule current when it was
   * recorded: NJT reissues GTFS regularly and reuses trip ids, so decoding a
   * June poll with an August schedule silently resolves to the wrong routes.
   */
  versionAt(epochSeconds: number): GtfsStaticVersion | null {
    const row = this.db.get<VersionRow>(
      /* sql */ `
        SELECT * FROM gtfs_static_versions
        WHERE effective_from <= :at AND (effective_to IS NULL OR effective_to > :at)
        ORDER BY effective_from DESC
        LIMIT 1
      `,
      { at: epochSeconds },
    );
    return row ? toVersion(row) : null;
  }

  /**
   * Across all versions, not just the current one: NJT's feed changes shape
   * (Port Jervis is its own route in some feeds, folded into the Main Line in
   * others) and historical events were labelled against the version of the day.
   */
  knownLineNames(): string[] {
    return this.db
      .all<{ lineName: string }>("SELECT DISTINCT line_name AS lineName FROM gtfs_routes")
      .map((r) => r.lineName);
  }

  canonicalRouteFor(versionId: string, sourceRouteId: string): string | null {
    const row = this.db.get<{ canonicalRouteId: string }>(
      "SELECT canonical_route_id AS canonicalRouteId FROM gtfs_route_aliases WHERE version_id = :v AND source_route_id = :s",
      { v: versionId, s: sourceRouteId },
    );
    return row?.canonicalRouteId ?? null;
  }

  routeAliases(versionId: string): GtfsRouteAliasRecord[] {
    return this.db.all<GtfsRouteAliasRecord>(
      "SELECT source_route_id AS sourceRouteId, canonical_route_id AS canonicalRouteId FROM gtfs_route_aliases WHERE version_id = :v",
      { v: versionId },
    );
  }

  replaceStops(versionId: string, stops: readonly GtfsStopRecord[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO gtfs_stops (version_id, stop_id, stop_name, stop_lat, stop_lon) VALUES (:v, :id, :n, :lat, :lon)",
    );
    this.db.transaction(() => {
      for (const s of stops)
        stmt.run({ v: versionId, id: s.stopId, n: s.stopName, lat: s.stopLat ?? null, lon: s.stopLon ?? null });
    });
  }

  replaceTrips(versionId: string, trips: readonly GtfsTripRecord[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO gtfs_trips (version_id, trip_id, route_id, service_id, direction_id, trip_headsign) VALUES (:v, :t, :r, :s, :d, :h)",
    );
    this.db.transaction(() => {
      for (const t of trips)
        stmt.run({
          v: versionId,
          t: t.tripId,
          r: t.routeId,
          s: t.serviceId ?? null,
          d: t.directionId ?? null,
          h: t.tripHeadsign ?? null,
        });
    });
  }

  replaceStopTimes(versionId: string, stopTimes: readonly GtfsStopTimeRecord[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO gtfs_stop_times (version_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time) VALUES (:v, :t, :s, :seq, :a, :d)",
    );
    this.db.transaction(() => {
      for (const st of stopTimes)
        stmt.run({
          v: versionId,
          t: st.tripId,
          s: st.stopId,
          seq: st.stopSequence,
          a: st.arrivalTime ?? null,
          d: st.departureTime ?? null,
        });
    });
  }

  routes(versionId: string): GtfsRouteRecord[] {
    return this.db.all<GtfsRouteRecord>(
      "SELECT route_id AS routeId, line_name AS lineName, route_color AS color, route_mode AS mode FROM gtfs_routes WHERE version_id = :v ORDER BY line_name",
      { v: versionId },
    );
  }

  allStops(versionId: string): GtfsStopCoord[] {
    return this.db.all<GtfsStopCoord>(
      "SELECT stop_id AS stopId, stop_name AS stopName, stop_lat AS lat, stop_lon AS lon FROM gtfs_stops WHERE version_id = :v",
      { v: versionId },
    );
  }

  /** The longest trip on the route, taken as the line's path. */
  representativeStopSequence(versionId: string, routeId: string): GtfsStopTimeRecord[] {
    const longest = this.db.get<{ tripId: string }>(
      /* sql */ `
        SELECT st.trip_id AS tripId
        FROM gtfs_stop_times st JOIN gtfs_trips t ON t.version_id = st.version_id AND t.trip_id = st.trip_id
        WHERE st.version_id = :v AND t.route_id = :r
        GROUP BY st.trip_id ORDER BY COUNT(*) DESC LIMIT 1
      `,
      { v: versionId, r: routeId },
    );
    return longest ? this.stopTimesForTrip(versionId, longest.tripId) : [];
  }

  lineNameForRoute(versionId: string, routeId: string): string | null {
    const row = this.db.get<{ lineName: string }>(
      "SELECT line_name AS lineName FROM gtfs_routes WHERE version_id = :v AND route_id = :r",
      { v: versionId, r: routeId },
    );
    return row?.lineName ?? null;
  }

  stopName(versionId: string, stopId: string): string | null {
    const row = this.db.get<{ stopName: string }>(
      "SELECT stop_name AS stopName FROM gtfs_stops WHERE version_id = :v AND stop_id = :s",
      { v: versionId, s: stopId },
    );
    return row?.stopName ?? null;
  }

  tripMeta(versionId: string, tripId: string): { routeId: string; directionId: number | null } | null {
    return (
      this.db.get<{ routeId: string; directionId: number | null }>(
        "SELECT route_id AS routeId, direction_id AS directionId FROM gtfs_trips WHERE version_id = :v AND trip_id = :t",
        { v: versionId, t: tripId },
      ) ?? null
    );
  }

  stopTimesForTrip(versionId: string, tripId: string): GtfsStopTimeRecord[] {
    return this.db.all<GtfsStopTimeRecord>(
      "SELECT trip_id AS tripId, stop_id AS stopId, stop_sequence AS stopSequence, arrival_time AS arrivalTime, departure_time AS departureTime FROM gtfs_stop_times WHERE version_id = :v AND trip_id = :t ORDER BY stop_sequence",
      { v: versionId, t: tripId },
    );
  }

  /**
   * Scheduled arrival per `tripId|stopId`, for many trips at once. GTFS keeps
   * "HH:MM:SS" with hours past 24 for a trip that runs into the next day, so the
   * strings sort chronologically within a service date without being parsed.
   */
  arrivalTimesForTrips(versionId: string, tripIds: readonly string[]): Map<string, string> {
    const unique = [...new Set(tripIds)];
    if (unique.length === 0) return new Map();
    const placeholders = unique.map((_, i) => `:t${i}`).join(",");
    const params = Object.fromEntries(unique.map((id, i) => [`t${i}`, id]));
    const rows = this.db.all<{ tripId: string; stopId: string; arrivalTime: string | null }>(
      /* sql */ `
        SELECT trip_id AS tripId, stop_id AS stopId, arrival_time AS arrivalTime
        FROM gtfs_stop_times
        WHERE version_id = :v AND trip_id IN (${placeholders})
      `,
      { v: versionId, ...params },
    );
    return new Map(
      rows.filter((r) => r.arrivalTime !== null).map((r) => [`${r.tripId}|${r.stopId}`, r.arrivalTime as string]),
    );
  }

  stationsWithLines(versionId: string): StationWithLines[] {
    const rows = this.db.all<{ stopId: string; stopName: string; routes: string | null }>(
      /* sql */ `
        SELECT s.stop_id AS stopId, s.stop_name AS stopName,
               group_concat(DISTINCT t.route_id) AS routes
        FROM gtfs_stops s
        JOIN gtfs_stop_times st ON st.version_id = s.version_id AND st.stop_id = s.stop_id
        JOIN gtfs_trips t       ON t.version_id = st.version_id AND t.trip_id = st.trip_id
        WHERE s.version_id = :v
        GROUP BY s.stop_id, s.stop_name
        ORDER BY s.stop_name
      `,
      { v: versionId },
    );
    return rows.map((r) => ({
      stopId: r.stopId,
      stopName: r.stopName,
      lines: r.routes ? r.routes.split(",") : [],
    }));
  }
}
