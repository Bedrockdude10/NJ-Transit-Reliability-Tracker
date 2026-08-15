/**
 * Database schema as an ordered list of migrations. Each migration runs once,
 * tracked in `schema_migrations`. To evolve the schema, append a new migration
 * — never edit an applied one.
 *
 * Storage conventions: instants are INTEGER epoch seconds, except `*_ms`
 * columns which are epoch milliseconds. Booleans are INTEGER 0/1. Map-valued
 * aggregate fields are stored as JSON TEXT.
 */

export interface Migration {
  id: string;
  up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "001_initial_schema",
    up: /* sql */ `
      -- ===== Raw + parsed ingest =========================================
      CREATE TABLE trip_stop_events (
        trip_id              TEXT    NOT NULL,
        route_id             TEXT    NOT NULL,
        line_name            TEXT    NOT NULL,
        stop_id              TEXT    NOT NULL,
        stop_name            TEXT    NOT NULL,
        stop_sequence        INTEGER NOT NULL,
        direction            TEXT    NOT NULL,
        service_date         TEXT    NOT NULL,
        scheduled_arrival    INTEGER,
        scheduled_departure  INTEGER,
        observed_arrival     INTEGER,
        delay_seconds        INTEGER,
        stop_skipped         INTEGER NOT NULL DEFAULT 0,
        trip_cancelled       INTEGER NOT NULL DEFAULT 0,
        gtfs_static_version  TEXT    NOT NULL,
        ingested_at_ms       INTEGER NOT NULL,
        PRIMARY KEY (trip_id, stop_id, service_date)
      );
      CREATE INDEX idx_tse_service_date ON trip_stop_events(service_date);
      CREATE INDEX idx_tse_route_date   ON trip_stop_events(route_id, service_date);
      CREATE INDEX idx_tse_stop_date    ON trip_stop_events(stop_id, service_date);
      CREATE INDEX idx_tse_trip_date    ON trip_stop_events(trip_id, service_date);

      CREATE TABLE raw_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        feed_type     TEXT    NOT NULL,
        fetched_at_ms INTEGER NOT NULL,
        raw_bytes     BLOB    NOT NULL
      );
      CREATE INDEX idx_snapshots_feed_time ON raw_snapshots(feed_type, fetched_at_ms);

      CREATE TABLE service_alerts (
        alert_id         TEXT PRIMARY KEY,
        affected_routes  TEXT NOT NULL,  -- JSON array of route_ids
        affected_stops   TEXT NOT NULL,  -- JSON array of stop_ids
        header_text      TEXT NOT NULL,
        description_text TEXT NOT NULL,
        effect_type      TEXT NOT NULL,
        active_from      INTEGER,
        active_to        INTEGER,
        first_seen_ms    INTEGER NOT NULL,
        last_seen_ms     INTEGER NOT NULL
      );
      CREATE INDEX idx_alerts_first_seen ON service_alerts(first_seen_ms);

      -- ===== GTFS static =================================================
      CREATE TABLE gtfs_static_versions (
        version_id     TEXT PRIMARY KEY,
        effective_from INTEGER NOT NULL,
        effective_to   INTEGER,
        checksum       TEXT    NOT NULL,
        ingested_at_ms INTEGER NOT NULL
      );
      CREATE TABLE gtfs_static_files (
        version_id TEXT NOT NULL,
        filename   TEXT NOT NULL,
        content    BLOB NOT NULL,
        PRIMARY KEY (version_id, filename)
      );
      CREATE TABLE gtfs_routes (
        version_id TEXT NOT NULL,
        route_id   TEXT NOT NULL,
        line_name  TEXT NOT NULL,
        PRIMARY KEY (version_id, route_id)
      );
      CREATE TABLE gtfs_stops (
        version_id TEXT NOT NULL,
        stop_id    TEXT NOT NULL,
        stop_name  TEXT NOT NULL,
        stop_lat   REAL,
        stop_lon   REAL,
        PRIMARY KEY (version_id, stop_id)
      );
      CREATE TABLE gtfs_trips (
        version_id    TEXT NOT NULL,
        trip_id       TEXT NOT NULL,
        route_id      TEXT NOT NULL,
        service_id    TEXT,
        direction_id  INTEGER,
        trip_headsign TEXT,
        PRIMARY KEY (version_id, trip_id)
      );
      CREATE TABLE gtfs_stop_times (
        version_id     TEXT    NOT NULL,
        trip_id        TEXT    NOT NULL,
        stop_id        TEXT    NOT NULL,
        stop_sequence  INTEGER NOT NULL,
        arrival_time   TEXT,   -- GTFS "HH:MM:SS", hours may exceed 24
        departure_time TEXT,
        PRIMARY KEY (version_id, trip_id, stop_sequence)
      );
      CREATE INDEX idx_stop_times_trip ON gtfs_stop_times(version_id, trip_id);
      CREATE INDEX idx_stop_times_stop ON gtfs_stop_times(version_id, stop_id);

      -- ===== Official NJT metrics ========================================
      CREATE TABLE official_njt_metrics (
        year                        INTEGER NOT NULL,
        month                       INTEGER NOT NULL,
        line_name                   TEXT    NOT NULL,
        otp_percent                 REAL    NOT NULL,
        otp_percent_amtrak_adjusted REAL,
        trips_operated              INTEGER NOT NULL,
        cancellations               INTEGER NOT NULL,
        PRIMARY KEY (year, month, line_name)
      );

      -- ===== Pre-computed daily aggregates ===============================
      CREATE TABLE otp_aggregates (
        scope             TEXT    NOT NULL,  -- system | line
        scope_id          TEXT    NOT NULL,  -- 'system' or route_id
        service_date      TEXT    NOT NULL,
        direction         TEXT    NOT NULL,  -- all | inbound | outbound
        trips_operated    INTEGER NOT NULL,
        trips_cancelled   INTEGER NOT NULL,
        on_time_counts    TEXT    NOT NULL,  -- JSON { thresholdSeconds: count }
        sum_delay_seconds REAL    NOT NULL,
        PRIMARY KEY (scope, scope_id, service_date, direction)
      );

      CREATE TABLE delay_distribution_aggregates (
        scope        TEXT NOT NULL,
        scope_id     TEXT NOT NULL,
        service_date TEXT NOT NULL,
        counts       TEXT NOT NULL,  -- JSON { bucketLabel: count }
        PRIMARY KEY (scope, scope_id, service_date)
      );

      CREATE TABLE heatmap_aggregates (
        scope             TEXT    NOT NULL,
        scope_id          TEXT    NOT NULL,
        type              TEXT    NOT NULL,  -- hour_of_day | day_of_week
        bucket            INTEGER NOT NULL,
        service_date      TEXT    NOT NULL,
        sum_delay_seconds REAL    NOT NULL,
        observations      INTEGER NOT NULL,
        PRIMARY KEY (scope, scope_id, type, bucket, service_date)
      );

      CREATE TABLE trip_daily_aggregates (
        trip_id               TEXT NOT NULL,
        service_date          TEXT NOT NULL,
        route_id              TEXT NOT NULL,
        line_name             TEXT NOT NULL,
        direction             TEXT NOT NULL,
        terminal_stop_name    TEXT NOT NULL,
        terminal_delay_seconds INTEGER,  -- null when the trip didn't run
        PRIMARY KEY (trip_id, service_date)
      );
      CREATE INDEX idx_trip_daily_route_date ON trip_daily_aggregates(route_id, service_date);

      CREATE TABLE station_daily_aggregates (
        stop_id                            TEXT    NOT NULL,
        service_date                       TEXT    NOT NULL,
        line_name                          TEXT    NOT NULL,
        direction                          TEXT    NOT NULL,
        sum_arrival_delay_seconds          REAL    NOT NULL,
        observations                       INTEGER NOT NULL,
        arrived_within_5min                INTEGER NOT NULL,
        departed_late_after_on_time_arrival INTEGER NOT NULL,
        PRIMARY KEY (stop_id, service_date, line_name, direction)
      );
      CREATE INDEX idx_station_daily_date ON station_daily_aggregates(stop_id, service_date);

      CREATE TABLE station_hourly_aggregates (
        stop_id           TEXT    NOT NULL,
        service_date      TEXT    NOT NULL,
        hour              INTEGER NOT NULL,
        sum_delay_seconds REAL    NOT NULL,
        observations      INTEGER NOT NULL,
        PRIMARY KEY (stop_id, service_date, hour)
      );

      CREATE TABLE station_distribution_aggregates (
        stop_id      TEXT NOT NULL,
        service_date TEXT NOT NULL,
        counts       TEXT NOT NULL,  -- JSON
        PRIMARY KEY (stop_id, service_date)
      );

      CREATE TABLE connection_aggregates (
        inbound_trip_id            TEXT    NOT NULL,
        transfer_stop_id           TEXT    NOT NULL,
        outbound_trip_id           TEXT    NOT NULL,
        service_date               TEXT    NOT NULL,
        observations               INTEGER NOT NULL,
        successes                  INTEGER NOT NULL,
        peak_observations          INTEGER NOT NULL,
        peak_successes             INTEGER NOT NULL,
        off_peak_observations      INTEGER NOT NULL,
        off_peak_successes         INTEGER NOT NULL,
        by_day_of_week             TEXT    NOT NULL,  -- JSON
        inbound_delay_distribution TEXT    NOT NULL,  -- JSON
        PRIMARY KEY (inbound_trip_id, transfer_stop_id, outbound_trip_id, service_date)
      );
      CREATE INDEX idx_connection_triple
        ON connection_aggregates(inbound_trip_id, transfer_stop_id, outbound_trip_id);

      -- ===== Pipeline health =============================================
      CREATE TABLE feed_health (
        feed_type          TEXT PRIMARY KEY,
        last_success_at_ms INTEGER,
        last_failure_at_ms INTEGER
      );
      CREATE TABLE ingest_daily_stats (
        date      TEXT    NOT NULL,  -- YYYY-MM-DD (UTC of the poll)
        feed_type TEXT    NOT NULL,
        polls     INTEGER NOT NULL DEFAULT 0,
        failures  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, feed_type)
      );
      CREATE TABLE data_gaps (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        feed_type TEXT    NOT NULL,
        start_ms  INTEGER NOT NULL,
        end_ms    INTEGER NOT NULL
      );
      CREATE TABLE request_budget (
        date         TEXT    NOT NULL,  -- YYYY-MM-DD (UTC)
        budget_group TEXT    NOT NULL,  -- gtfs_rt | xml_api
        count        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, budget_group)
      );
      CREATE TABLE pipeline_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: "002_cancellation_causes_and_mdbf",
    up: /* sql */ `
      -- Per-month cancellation breakdown by NJT cause category (JSON map).
      ALTER TABLE official_njt_metrics ADD COLUMN cancellation_causes TEXT;

      -- Systemwide fleet Mean Distance Between Failures (miles), monthly.
      CREATE TABLE official_fleet_mdbf (
        year  INTEGER NOT NULL,
        month INTEGER NOT NULL,
        mdbf  INTEGER NOT NULL,
        PRIMARY KEY (year, month)
      );
    `,
  },
  {
    id: "003_light_rail",
    up: /* sql */ `
      -- Systemwide light rail on-time performance, monthly.
      CREATE TABLE light_rail_otp (
        year        INTEGER NOT NULL,
        month       INTEGER NOT NULL,
        otp_percent REAL    NOT NULL,
        PRIMARY KEY (year, month)
      );

      -- Per-line light rail Mean Distance Between Failures (miles), monthly.
      CREATE TABLE light_rail_mdbf (
        year      INTEGER NOT NULL,
        month     INTEGER NOT NULL,
        line_name TEXT    NOT NULL,
        mdbf      INTEGER NOT NULL,
        PRIMARY KEY (year, month, line_name)
      );
    `,
  },
  {
    id: "004_route_color",
    up: /* sql */ `
      -- Official NJT route color (hex, no leading #) from GTFS routes.txt.
      ALTER TABLE gtfs_routes ADD COLUMN route_color TEXT;
    `,
  },
  {
    id: "005_route_mode",
    up: /* sql */ `
      -- Transit mode: 'rail' (commuter) or 'light_rail'. Lets the map include
      -- light rail while line/official screens stay commuter-rail only.
      ALTER TABLE gtfs_routes ADD COLUMN route_mode TEXT NOT NULL DEFAULT 'rail';
    `,
  },
  {
    id: "006_gtfs_trips_route_index",
    up: /* sql */ `
      -- Speeds gtfs.representativeStopSequence (used by /map): find a route's
      -- trips without scanning all trips in a version.
      CREATE INDEX idx_trips_route ON gtfs_trips(version_id, route_id);
    `,
  },
  {
    id: "007_gtfs_route_aliases",
    up: /* sql */ `
      -- Source GTFS route_id -> canonical catalog route_id. GTFS static ingest
      -- collapses variant routes onto one canonical line (NJCL + NJCLL, Main /
      -- Bergen / Port Jervis), so gtfs_routes holds only canonical ids. The
      -- real-time feed still reports the *source* ids, and an RT trip that
      -- isn't in the static schedule has no trip row to resolve through --
      -- without this map its raw route_id ("10") was stored as the line name.
      CREATE TABLE gtfs_route_aliases (
        version_id         TEXT NOT NULL,
        source_route_id    TEXT NOT NULL,
        canonical_route_id TEXT NOT NULL,
        PRIMARY KEY (version_id, source_route_id)
      );
    `,
  },
  {
    id: "008_vehicle_positions",
    up: /* sql */ `
      -- Current position of every active train, from the GTFS-RT
      -- VehiclePositions feed. Each poll returns a complete snapshot, so this
      -- table is replaced wholesale on ingest and stays bounded (hundreds of
      -- rows); position *history* lives in raw_snapshots, kept for replay.
      CREATE TABLE vehicle_positions (
        vehicle_id     TEXT    NOT NULL PRIMARY KEY,
        trip_id        TEXT,
        route_id       TEXT,
        line_name      TEXT,
        direction      TEXT,
        latitude       REAL    NOT NULL,
        longitude      REAL    NOT NULL,
        bearing        REAL,
        speed_mps      REAL,
        stop_id        TEXT,
        stop_name      TEXT,
        status         TEXT,
        reported_at    INTEGER,
        ingested_at_ms INTEGER NOT NULL
      );
      CREATE INDEX idx_vehicle_positions_route ON vehicle_positions(route_id);
    `,
  },
  {
    id: "009_snapshots_feed_id_index",
    up: /* sql */ `
      -- Paging the archive by id had no index to satisfy its ORDER BY, so
      -- SQLite sorted every matching row into a temp B-tree to take 100 of
      -- them: quadratic in the size of the archive, and invisible until it
      -- was run over more than a day's worth. This index makes a keyset scan
      -- ordered by construction.
      CREATE INDEX idx_snapshots_feed_id ON raw_snapshots(feed_type, id);
    `,
  },
  {
    id: "010_predictions",
    up: /* sql */ `
      -- Model output, landed from object storage so the API can serve it from a
      -- local read. Produced by njt-delay-modeling; nothing here derives from it.
      --
      -- Keyed on the leg rather than the trip: one trip carries a prediction
      -- from each stop to each later stop, and keying on the trip alone would
      -- keep only whichever was imported last. The modelling repo rewrites a
      -- whole service date when it re-runs, so writes replace.
      CREATE TABLE predictions (
        trip_id                 TEXT    NOT NULL,
        line_name               TEXT    NOT NULL,
        service_date            TEXT    NOT NULL,
        from_stop_id            TEXT    NOT NULL,
        to_stop_id              TEXT    NOT NULL,
        predicted_at            INTEGER NOT NULL,
        horizon_seconds         INTEGER NOT NULL,
        predicted_delay_seconds REAL    NOT NULL,
        -- Null until the trip has run. Distinct from 0, which means "on time".
        actual_delay_seconds    REAL,
        model_version           TEXT    NOT NULL,
        run_id                  TEXT    NOT NULL,
        PRIMARY KEY (trip_id, from_stop_id, to_stop_id, service_date)
      );
      CREATE INDEX idx_predictions_date_line ON predictions(service_date, line_name);
    `,
  },
];
