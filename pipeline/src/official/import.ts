import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { importNjtPerformanceDir } from "./njt-performance";

/** CLI: import NJT's published per-line performance CSVs from a directory. */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const dir = process.env.NJT_PERFORMANCE_DIR ?? "./data";

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));
const result = importNjtPerformanceDir(repos, dir);

console.log(`Imported ${result.totalMetrics} official metrics across ${result.lines.length} lines from ${dir}:`);
for (const line of result.lines) console.log(`  ${line.lineName}: ${line.metrics} months`);
if (result.mdbfMonths > 0) console.log(`  Fleet MDBF: ${result.mdbfMonths} months`);
if (result.lightRailOtpMonths > 0) console.log(`  Light rail OTP: ${result.lightRailOtpMonths} months`);
if (result.lightRailMdbfRows > 0) console.log(`  Light rail MDBF: ${result.lightRailMdbfRows} rows`);
if (result.lines.length === 0) {
  console.log("  (no RAIL_<CODE>_OTP_DATA.csv files found — check NJT_PERFORMANCE_DIR)");
}
