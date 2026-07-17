/**
 * `npm run dev:seed` — populate a LOCAL database with synthetic data so the app
 * can be run and iterated on without waiting for the live feed to accrue.
 *
 * FOR LOCAL DEVELOPMENT ONLY. This writes synthetic measurement data; never run
 * it against a deployed/production database. Typical loop:
 *
 *   npm run dev:seed        # writes ./data/njt.sqlite (or $NJT_DB_PATH)
 *   npm run api             # serves it
 *   npm run web --workspace app
 *
 * To clear synthetic data from a database, run `node deploy/purge-synthetic.mjs`.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { seedFixture, seedRecentDevData } from "./fixture";

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const today = toLocalDateString(Math.floor(Date.now() / 1000));

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
const repos = createRepositories(db);

seedFixture(repos);
seedRecentDevData(repos, today);
db.close();

console.log(
  [
    "",
    "  ⚠  DEV FIXTURE — synthetic data written for LOCAL development only.",
    `     db:    ${dbPath}`,
    `     through: ${today} (recent multi-line data + ~18 months of NJT history)`,
    "     Do NOT deploy this database. Clear it with: node deploy/purge-synthetic.mjs",
    "",
    "  Next:  npm run api   (then)   npm run web --workspace app",
    "",
  ].join("\n"),
);
