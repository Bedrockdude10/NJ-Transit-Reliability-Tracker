# NJ Transit Reliability Dashboard — Full System PRD

## What This Is

A persistent, publicly accessible tool for tracking the real reliability of NJ Transit commuter rail — not the sanitized monthly averages NJT publishes, but per-train, per-stop delay data across all lines, continuously collected and displayed. It also models the probability of making timed connections between trains.

The core gap: NJT publishes monthly aggregate on-time percentages using a loose 6-minute threshold, with no per-train records and no delay duration data. Bloomberg News built an independent version of this using NJT's own real-time feed for a single summer (2025) as a journalism project, then stopped. This project runs permanently.

---

## System Architecture

The system has three independent components that must be built and deployed as a monorepo:

```
┌─────────────────────────────────┐
│        Ingest Pipeline          │  Long-running background process.
│  (polls NJT feeds every 30s)    │  Writes to database continuously.
└────────────────┬────────────────┘
                 │ writes
                 ▼
┌─────────────────────────────────┐
│           Database              │  Stores all raw and parsed data,
│   (events, alerts, schedules,   │  pre-computed aggregates,
│    aggregates, raw snapshots)   │  and official NJT metrics.
└────────────────┬────────────────┘
                 │ reads
                 ▼
┌─────────────────────────────────┐
│           Backend API           │  Stateless HTTP API. Serves
│     (REST, read-only for        │  pre-aggregated data to the
│      frontend consumers)        │  frontend. No business logic.
└────────────────┬────────────────┘
                 │ fetches
                 ▼
┌─────────────────────────────────┐
│     Frontend (Expo Router)      │  Single codebase targeting web,
│   Web + iOS + Android           │  iOS, and Android. Read-only
│                                 │  data display and exploration.
└─────────────────────────────────┘
```

The pipeline, API, and frontend are decoupled. The pipeline never directly serves the frontend. The frontend never directly queries the database. The API is the only bridge.

---

## Platforms and Stack Guidance

**Frontend**: Use **Expo with Expo Router**. This targets web, iOS, and Android from a single codebase with file-based routing. Do not build separate web and mobile implementations.

**Charting**: The best web-only charting libraries (D3, Recharts, Chart.js) do not run in React Native. Use charting libraries with explicit cross-platform support (Victory Native, react-native-gifted-charts, or similar). Do not use a web-only library and work around it — the constraint applies from the start.

**Project structure**: Monorepo. Suggested layout:
```
/pipeline    — ingest worker (long-running process)
/api         — backend HTTP server
/app         — Expo frontend (web + mobile)
/shared      — types and constants shared across components
```

**UI**: Keep it simple. This is a data display product. Standard charts, clean readable typography, minimal decoration. No custom UI framework needed.

**Deployment**: Each component deploys independently:
- Pipeline: any environment that supports a persistent long-running process (not serverless — it must run continuously)
- API: serverless functions or a lightweight server are both fine; it is stateless and read-only
- Frontend web: static hosting (Vercel, Netlify, or equivalent)
- Frontend mobile: iOS via Expo EAS / App Store, Android via Expo EAS / Play Store

---

## Data Sources

### 1. GTFS Static Feed
- **Access**: Free registration at `developer.njtransit.com`; ZIP download
- **Contents**: Routes, trips, stops, stop_times, calendar, calendar_dates — the full published schedule
- **Update cadence**: NJT emails registered developers when timetables change; also check weekly as a fallback
- **Role**: Ground truth for what was scheduled. All delay calculations are diffs against this.
- **Quirk**: NJT's GTFS static does not always match their internal train control system. Treat it as the authoritative public schedule, not a replica of internal operations. Trip ID mismatches between static and real-time are common and must be logged.

### 2. GTFS-RT Feed (three sub-feeds)
- **Access**: Same developer portal; API key required
- **Rate limit**: 100,000 requests/day across all sub-feeds
- **TripUpdates**: Per-trip, per-stop predicted arrival/departure times and delay in seconds. Primary ingest target.
- **VehiclePositions**: Lat/lon of active vehicles plus delay data. Secondary; collect but lower priority than TripUpdates.
- **ServiceAlerts**: Text alerts with affected routes, stops, and time windows.
- **Critical behavior**: The feed is ephemeral — each poll overwrites the previous snapshot. There is no archive. Any gap in polling is a permanent data gap.
- **NJT disclaimer**: NJT's terms disclaim accuracy and completeness of this feed. Their spokesperson challenged Bloomberg's analysis using this same data. Display a disclaimer in the UI.

### 3. NJT XML Train Control API
- **Access**: `datasource.njtransit.com`; separate registration from GTFS portal
- **Key endpoint**: `getVehicleDataXML` — current position, next station, and `secondsLate` for every active train moved in the last 5 minutes
- **Rate limit**: 40,000 requests/day
- **Role**: Supplementary to GTFS-RT. NJT's GTFS-RT feed is derived from this system. Collect both and prefer whichever produces more complete delay data for a given trip; validate during development.

### 4. Official NJT Performance CSVs
- **Access**: `njtransit.com/performance-data-download`; no registration; direct download
- **Contents**: Monthly OTP percentage and cancellation counts per line, raw and Amtrak-adjusted, back to January 2017
- **Role**: Comparison baseline. The dashboard shows NJT's own reported numbers alongside independently computed figures to make the gap visible.

---

## Data Model

All entities below must be stored. Schema design is at the implementor's discretion.

### TripStopEvent — core record
One record per train trip per stop, representing the final observed or predicted delay at that stop.

Fields:
- `trip_id` — from GTFS
- `route_id`, `line_name`
- `stop_id`, `stop_name`
- `stop_sequence`
- `direction` — inbound or outbound
- `service_date` — calendar date of the trip, not wall-clock timestamp
- `scheduled_arrival`, `scheduled_departure` — from GTFS static
- `observed_arrival` — predicted arrival at time of final reading
- `delay_seconds` — positive = late, negative = early
- `stop_skipped` — boolean
- `trip_cancelled` — boolean
- `gtfs_static_version` — which GTFS static snapshot this was matched against
- `ingested_at`

**On "final reading"**: GTFS-RT predictions update continuously as a train approaches a stop. Capture the prediction closest to or just after the scheduled arrival time as the authoritative delay for that stop. Store earlier predictions too if practical; they enable trajectory and predictability analysis but are lower priority than final readings.

### RawSnapshot
One record per GTFS-RT poll.

Fields:
- `feed_type` — TripUpdates, VehiclePositions, or ServiceAlerts
- `fetched_at`
- `raw_bytes` — the raw protobuf payload
- Purpose: enables reprocessing if parsing logic is updated. Retain indefinitely.

### ServiceAlert
- `alert_id`
- `affected_routes` — list
- `affected_stops` — list
- `header_text`, `description_text`
- `effect_type` — delay, cancellation, detour, etc.
- `active_from`, `active_to`
- `ingested_at`

### GtfsStaticVersion
- `version_id`
- `effective_from`, `effective_to`
- The actual GTFS files, stored so historical trip events can always be joined to the schedule in effect at the time

### OfficialNjtMetric
- `month`, `year`
- `line_name`
- `otp_percent` — NJT definition: within 6 minutes
- `otp_percent_amtrak_adjusted`
- `trips_operated`, `cancellations`

### AggregateSnapshot — pre-computed for dashboard queries
The dashboard must not run expensive aggregations on the raw event table at request time. A background job (part of the pipeline) recomputes these on a schedule and writes them to an aggregate table. The API reads from this table, not TripStopEvent directly.

Aggregates to maintain:
- System-wide and per-line OTP at thresholds: 5, 10, 15, 30, 60 minutes — daily, rolling 7d, rolling 30d, rolling 90d
- Cancellation rate — same time windows
- Delay duration distribution buckets — per line, per day
- Average delay by hour-of-day and day-of-week — per line
- Per-station average delay — daily
- Connection success rate per (inbound_trip, transfer_stop, outbound_trip) pair — updated daily

Recompute frequency: nightly for historical windows; hourly for "today so far."

---

## Component 1: Ingest Pipeline

The pipeline is a continuously running background process. It is not a web server. It has one job: poll NJT data sources on schedule, parse the results, and write to the database.

### Polling schedule
- GTFS-RT TripUpdates: every 30–60 seconds, all hours
- GTFS-RT VehiclePositions: every 60 seconds
- GTFS-RT ServiceAlerts: every 60 seconds
- NJT XML Train Control API: every 60 seconds (supplementary; may reduce if rate limits are tight)
- GTFS static sync: on NJT email notification, plus weekly check
- Official NJT performance CSVs: monthly
- Aggregate recomputation: nightly for historical windows, hourly for today

### Rate limit management
- Track daily request counts against GTFS-RT (100,000/day) and XML API (40,000/day) limits
- Maintain at least 20% headroom
- Degrade gracefully if approaching limits: extend TripUpdates polling interval before dropping any feed; drop VehiclePositions before TripUpdates; never drop TripUpdates

### Failure handling
- Retry failed requests with exponential backoff; do not write null or partial records
- Log every failure with timestamp, feed type, HTTP status, and error message
- Emit an alert (email or webhook) if no successful TripUpdates ingest for more than 60 minutes
- Pipeline crash must not cause data loss — on restart, resume from current state with no gap (the feed is live; historical data before the restart is gone, but the pipeline should not create additional gaps)

### Data integrity
- Store raw protobuf snapshots for every successful poll, indefinitely. Data density: ~100 KB per snapshot × 1,440 polls/day ≈ 144 MB/day raw, ~50 GB/year uncompressed. At commodity blob storage pricing this is under $1/month. No retention limit.
- Log all trip ID mismatches between GTFS-RT and current GTFS static
- Deduplicate TripStopEvent records: for a given (trip_id, stop_id, service_date), retain the reading closest to scheduled_arrival as the final reading

### Pipeline health record
Maintain a running log of: last successful ingest timestamp per feed, daily poll counts, daily failure counts, any known data gaps. The API exposes this for display in the dashboard.

---

## Component 2: Backend API

A stateless read-only HTTP API. It serves pre-computed aggregate data to the frontend. It does not write anything. It does not run aggregations — those are pre-computed by the pipeline. All endpoints return JSON.

All date range parameters default to last 30 days if not specified.

### Endpoints

**Pipeline health**
- `GET /health` — last successful ingest per feed, pipeline uptime, known data gaps, collection start date

**System overview**
- `GET /system/summary` — params: `from`, `to` — system-wide OTP at each threshold, total trips operated, total cancelled, delay distribution
- `GET /system/heatmap` — params: `from`, `to`, `type` (hour-of-day or day-of-week) — average delay by time bucket, all lines combined

**Lines**
- `GET /lines` — list of all active lines with identifiers and names
- `GET /lines/:lineId/summary` — params: `from`, `to` — OTP at each threshold, cancellation rate, inbound vs outbound breakdown, NJT official OTP for same period
- `GET /lines/:lineId/trend` — params: `from`, `to`, `interval` (daily or weekly) — time series of OTP and cancellation rate
- `GET /lines/:lineId/trips/worst` — params: `from`, `to`, `limit` — most delayed trips by average terminal delay
- `GET /lines/:lineId/heatmap` — params: `from`, `to`, `type` — delay by hour or day of week for this line

**Stations**
- `GET /stations` — all stations with identifiers, names, and which lines serve them
- `GET /stations/:stopId/summary` — params: `from`, `to` — average arrival delay by line and direction, delay distribution, time-of-day pattern, delay amplification rate
- `GET /stations/:stopId/top-delayed-trips` — worst-performing trips through this station

**Connection reliability**
- `GET /connections` — params: `inbound_trip_id`, `transfer_stop_id`, `outbound_trip_id`, `from`, `to` — historical connection success rate, broken down by day-of-week and hour; distribution of inbound delay at transfer stop; sample size (number of observations underlying the estimate)

**Service alerts**
- `GET /alerts` — params: `line`, `from`, `to`, `effect_type`, pagination — paginated alert log
- `GET /alerts/frequency` — params: `from`, `to` — alert counts per line and effect type

**CSV export**
- `GET /export` — params: `entity` (line, station, system), `id`, `from`, `to` — returns the same data as the summary endpoints as a downloadable CSV file

---

## Component 3: Frontend (Expo Router)

Single codebase. Targets web, iOS, and Android. All data comes from the Backend API — no direct database access, no NJT API calls from the frontend.

### Global behavior
- Public, no login required
- All screens are deep-linkable with stable URLs / universal links
- Persistent header or footer on all screens shows: data collection start date, last successful ingest timestamp, brief disclaimer ("Data sourced from NJT's public feeds. Independent of NJT official reporting.")
- All data views have a CSV export button that calls the export endpoint

### Screen: System Overview
Default landing screen. Time window selector (7d, 30d, 90d, custom).

Displays:
- OTP rate at each threshold (5, 10, 15, 30, 60 min) side by side with NJT's official 6-minute OTP for the same period — the gap between them is the point
- Total trips operated and cancelled
- Delay duration histogram across all lines (shows the long tail that "on-time" hides)
- Heatmap of average delay by day-of-week
- Heatmap of average delay by hour-of-day

### Screen: Line Detail
Reachable from System Overview or direct link.

Displays:
- All System Overview metrics scoped to this line
- Inbound vs. outbound breakdown
- Trend chart: rolling OTP at 15-minute threshold over the selected window (show NJT's 6-minute figure as a secondary line)
- Monthly comparison table: this project's OTP vs. NJT's reported OTP, all available months
- Top 10 most delayed trips (by average terminal delay)
- For NEC and North Jersey Coast lines: Amtrak-attributed vs. NJT-attributed delay split, sourced from NJT's official Amtrak-adjusted CSV data with a note that attribution is NJT's own

### Screen: Station Detail
Reachable from a station search or map.

Displays:
- Average arrival delay for all lines and directions serving this station
- Delay duration distribution for arrivals here
- Hour-of-day delay pattern
- Delay amplification: of trains that arrive within 5 minutes of schedule, what fraction depart late? (Detects dwell-time issues, crew changes, etc.)
- Top most-delayed trips through this station

### Screen: Connection Reliability
User selects:
- Inbound trip (search by line + approximate arrival time)
- Transfer station (auto-populated based on inbound trip stops)
- Outbound trip (search by line + departure time from transfer station)

Displays:
- Historical connection success rate with sample size shown
- Breakdown by day-of-week and peak vs. off-peak
- Distribution of inbound delay at transfer station for the selected trip
- Plain-English summary: "This connection succeeds X% of the time overall. On weekday evenings it drops to Y%. Based on Z observations."
- If sample size is low (under 30 observations), display a warning that the estimate is preliminary

### Screen: Service Alert Log
Displays:
- Filterable, paginated log of all ingested service alerts (by line, date, effect type)
- Summary: alert frequency per line over the last 90 days

### Screen: Pipeline Health (operator-facing, publicly viewable)
Displays:
- Collection start date
- Last successful ingest per feed type
- Daily poll counts and failure counts for the last 30 days
- Known data gaps (dates/times where collection failed)
- Pipeline uptime percentage

---

## Non-Goals for v1

- **Bus lines**: Rail only. Bus GTFS-RT data is a different feed, higher volume, and different reliability characteristics. Add later.
- **Real-time arrival predictions for riders**: Transit App, Google Maps, and NJT's own app do this. This project is retrospective analytics, not a trip planner.
- **Weather correlation**: Useful, requires a separate data source. Add in v2.
- **User accounts or saved searches**
- **Native push notifications**
- **Fare or accessibility data**
- **Connection probability ML model**: The Connection Reliability screen shows empirical historical rates in v1. A model that generalizes to unseen connection windows (e.g., after a timetable change) is v2. The data collected in v1 is the training set for that model.

---

## Compliance Requirements

- NJT API credentials stored securely, not committed to source control
- Dashboard must not claim data is accurate, complete, or real-time — include a brief disclaimer visible on every screen
- Dashboard must not display NJT's logo or imply NJT endorsement
- Must not proxy the raw NJT feed to end users (NJT ToS requires data be hosted on the developer's server)
- Must not exceed 100,000 requests/day on GTFS-RT or 40,000/day on the XML API
- Display pipeline uptime and known gaps — be transparent about data completeness

---

## Success Criteria

The system is complete and ready for public launch when:

1. The ingest pipeline has run continuously for at least 7 days with no unrecovered outages, collecting data for all NJT commuter rail lines across all three GTFS-RT sub-feeds
2. The aggregate computation job has run successfully and all dashboard screens render with real data — no placeholder states
3. The System Overview, Line Detail, Station Detail, Connection Reliability, Service Alert Log, and Pipeline Health screens all function on web, iOS simulator, and Android emulator from the same codebase
4. The Connection Reliability screen displays results with sample sizes for at least the 10 highest-frequency transfer pairs in the dataset
5. NJT's official OTP figures are displayed alongside independently computed figures on both the System Overview and Line Detail screens, with the gap visible
6. The CSV export function works on at least the System Overview and Line Detail endpoints
7. Any date range within the collection window can be queried without errors or timeouts
8. The pipeline health screen accurately reflects the collection history, including any gaps that occurred during development