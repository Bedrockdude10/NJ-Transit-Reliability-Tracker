import { describe, expect, it } from "vitest";
import { parseGtfsStatic } from "../src/gtfs-static/parse";

describe("parseGtfsStatic — branch coverage", () => {
  it("returns empty collections when the archive has no files", () => {
    const data = parseGtfsStatic({});
    expect(data).toEqual({ routes: [], routeAliases: [], stops: [], trips: [], stopTimes: [] });
  });

  it("drops trips whose route did not map to a canonical rail line", () => {
    const files = {
      "routes.txt": "route_id,route_long_name,route_short_name,route_type\nNE,Northeast Corridor,NEC,2\n",
      // TBUS references a route that isn't in routes.txt at all → dropped.
      "trips.txt": "trip_id,route_id,service_id,direction_id,trip_headsign\nT1,NE,WK,1,NY\nTBUS,BUS,WK,0,X\n",
    };
    const data = parseGtfsStatic(files);
    expect(data.trips.map((t) => t.tripId)).toEqual(["T1"]);
  });

  it("normalizes empty optional fields to null", () => {
    const files = {
      "routes.txt": "route_id,route_long_name,route_short_name,route_type\nNE,Northeast Corridor,NEC,2\n",
      // Empty service_id, direction_id, headsign.
      "trips.txt": "trip_id,route_id,service_id,direction_id,trip_headsign\nT1,NE,,,\n",
      // Empty arrival/departure times.
      "stop_times.txt": "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT1,NWK,1,,\n",
      // Missing lat/lon.
      "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nNWK,Newark Penn,,\n",
    };
    const data = parseGtfsStatic(files);
    expect(data.trips[0]).toMatchObject({ serviceId: null, directionId: null, tripHeadsign: null });
    expect(data.stopTimes[0]).toMatchObject({ arrivalTime: null, departureTime: null });
    expect(data.stops[0]).toMatchObject({ stopLat: null, stopLon: null });
  });

  it("keeps all stops when no rail stop_times constrain the set", () => {
    // Rail routes/trips exist but stop_times.txt is absent → usedStopIds empty,
    // so the stop filter keeps every row rather than dropping them all.
    const files = {
      "routes.txt": "route_id,route_long_name,route_short_name,route_type\nNE,Northeast Corridor,NEC,2\n",
      "trips.txt": "trip_id,route_id,service_id,direction_id,trip_headsign\nT1,NE,WK,1,NY\n",
      "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nNWK,Newark Penn,40.7,-74.1\nNYP,New York Penn,40.75,-74.0\n",
    };
    const data = parseGtfsStatic(files);
    expect(data.stops.map((s) => s.stopId).sort()).toEqual(["NWK", "NYP"]);
  });
});
