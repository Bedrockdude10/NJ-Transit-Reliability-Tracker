import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { findGtfsDir, importGtfsStatic } from "./import-static";

/** CLI: import the real NJT GTFS static rail feed from a directory. */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const dataDir = process.env.NJT_GTFS_DIR ?? "./data";

const gtfsDir = findGtfsDir(dataDir);
if (!gtfsDir) {
  console.error(`No GTFS feed found under ${dataDir} (expected stops.txt + routes.txt).`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));
const result = importGtfsStatic(repos, gtfsDir);
console.log(
  `Imported GTFS ${result.versionId} from ${gtfsDir}:\n` +
    `  ${result.routes} lines, ${result.stops} stops, ${result.trips} trips, ${result.stopTimes} stop_times.`,
);
