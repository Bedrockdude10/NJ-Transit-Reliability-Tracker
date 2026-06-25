import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { describe, expect, it } from "vitest";
import { findGtfsDir, importGtfsStatic } from "../src/gtfs/import-static";

// Minimal GTFS feed: NEC (rail), NJCL + NJCLL (rail variants → one line), and a
// light rail route (type 0) that must be excluded.
const ROUTES = `route_id,agency_id,route_short_name,route_long_name,route_type,route_url,route_color
10,"NJT","NEC","Northeast Corridor",2,"",DD3439
11,"NJT","NJCL","North Jersey Coast Line",2,"",03A3DF
12,"NJT","NJCLL","North Jersey Coast Line",2,"",03A3DF
4,"NJT","HBLR","Hudson-Bergen Light Rail",0,"",008080
`;

const STOPS = `stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id
NWK,1,"Newark Penn",,40.7347,-74.1644,1
NYP,2,"New York Penn",,40.7506,-73.9936,2
LRT,3,"Light Rail Stop",,40.7,-74.0,3
`;

const TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id
10,WK,T_NEC_1,New York,1
11,WK,T_NJCL_1,New York,1
4,WK,T_LR_1,Hoboken,0
`;

const STOP_TIMES = `trip_id,arrival_time,departure_time,stop_id,stop_sequence
T_NEC_1,08:00:00,08:01:00,NWK,1
T_NEC_1,08:20:00,08:21:00,NYP,2
T_NJCL_1,09:00:00,09:01:00,NWK,1
T_LR_1,07:00:00,07:00:00,LRT,1
`;

function writeFeed(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtfs-"));
  writeFileSync(join(dir, "routes.txt"), ROUTES);
  writeFileSync(join(dir, "stops.txt"), STOPS);
  writeFileSync(join(dir, "trips.txt"), TRIPS);
  writeFileSync(join(dir, "stop_times.txt"), STOP_TIMES);
  return dir;
}

describe("importGtfsStatic", () => {
  it("maps rail routes to canonical lines, collapses variants, excludes light rail", () => {
    const dir = writeFeed();
    const repos = createRepositories(openDatabase());
    const result = importGtfsStatic(repos, dir);

    // NEC + (NJCL/NJCLL collapsed) = 2 canonical lines; light rail excluded.
    expect(result.routes).toBe(2);
    const version = repos.gtfs.currentVersion()!;
    const routes = repos.gtfs.routes(version.versionId);
    const names = routes.map((r) => r.lineName).sort();
    expect(names).toEqual(["North Jersey Coast Line", "Northeast Corridor Line"]);
    expect(routes.find((r) => r.lineName === "Northeast Corridor Line")?.color).toBe("DD3439");
  });

  it("keeps real coordinates and builds a line path from stop_times", () => {
    const dir = writeFeed();
    const repos = createRepositories(openDatabase());
    importGtfsStatic(repos, dir);
    const version = repos.gtfs.currentVersion()!;

    const nwk = repos.gtfs.allStops(version.versionId).find((s) => s.stopId === "NWK");
    expect(nwk).toMatchObject({ stopName: "Newark Penn", lat: 40.7347, lon: -74.1644 });

    const seq = repos.gtfs.representativeStopSequence(version.versionId, "NE");
    expect(seq.map((s) => s.stopId)).toEqual(["NWK", "NYP"]);
  });

  it("findGtfsDir locates a feed directory", () => {
    const dir = writeFeed();
    expect(findGtfsDir(dir)).toBe(dir);
  });
});
