import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { loadGtfsStatic } from "../src/gtfs-static/load";
import { parseGtfsStatic } from "../src/gtfs-static/parse";

const FILES = {
  "routes.txt": "route_id,route_long_name,route_short_name,route_type\nNE,Northeast Corridor,NEC,2\nBUS1,Local Bus,B1,3\n",
  "trips.txt": "trip_id,route_id,service_id,direction_id,trip_headsign\nT1,NE,WK,1,New York\nTBUS,BUS1,WK,0,Downtown\n",
  "stop_times.txt":
    "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT1,NWK,1,08:00:00,08:01:00\nT1,NYP,2,08:20:00,08:21:00\nTBUS,B1,1,09:00:00,09:00:00\n",
  "stops.txt":
    "stop_id,stop_name,stop_lat,stop_lon\nNWK,Newark Penn,40.7,-74.1\nNYP,New York Penn,40.75,-73.99\nB1,Bus Stop,40.0,-74.0\n",
};

describe("parseGtfsStatic", () => {
  it("keeps only rail routes and their trips, stops, and stop_times", () => {
    const data = parseGtfsStatic(FILES);
    expect(data.routes).toEqual([{ routeId: "NE", lineName: "Northeast Corridor" }]);
    expect(data.trips.map((t) => t.tripId)).toEqual(["T1"]);
    expect(data.stopTimes.every((st) => st.tripId === "T1")).toBe(true);
    expect(data.stops.map((s) => s.stopId).sort()).toEqual(["NWK", "NYP"]); // bus stop B1 excluded
  });
});

describe("loadGtfsStatic", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  const zip = (): Uint8Array =>
    zipSync(Object.fromEntries(Object.entries(FILES).map(([name, text]) => [name, strToU8(text)])));

  it("stores a version, catalog, and raw files", () => {
    const result = loadGtfsStatic(repos, zip(), Date.UTC(2025, 6, 15));
    expect(result.unchanged).toBe(false);
    const version = repos.gtfs.currentVersion();
    expect(version?.versionId).toBe(result.versionId);
    expect(repos.gtfs.routes(result.versionId)).toHaveLength(1);
    const stations = repos.gtfs.stationsWithLines(result.versionId);
    expect(stations.find((s) => s.stopId === "NWK")?.lines).toEqual(["NE"]);
  });

  it("dedupes an unchanged archive by checksum", () => {
    const first = loadGtfsStatic(repos, zip(), 1);
    const second = loadGtfsStatic(repos, zip(), 2);
    expect(second).toEqual({ versionId: first.versionId, unchanged: true });
  });
});
