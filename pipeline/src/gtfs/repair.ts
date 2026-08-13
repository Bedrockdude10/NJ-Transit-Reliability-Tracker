import { createRepositories, openDatabase } from "@njt/db";
import { repairLineNames } from "./repair-line-names";

/** CLI: repair events stored under a raw feed route_id instead of a line name. */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";

const repos = createRepositories(openDatabase(dbPath));
const result = repairLineNames(repos);

if (result.aliasesBackfilled > 0) {
  console.log(`Backfilled ${result.aliasesBackfilled} route aliases from the archived routes.txt.`);
}
if (result.relabelled.length === 0) {
  console.log("No events stored under a raw route id — nothing to repair.");
} else {
  for (const r of result.relabelled) {
    console.log(`  "${r.from}" -> ${r.routeId} / "${r.to}" (${r.events} events)`);
  }
  console.log(`Recomputed aggregates for ${result.serviceDatesRecomputed.length} service dates.`);
}
