import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { buildDevFixture, hasRealObservations, isProductionPath } from "./dev-fixture";

/**
 * CLI: create a local development database with plausible data, so UI work can
 * be seen without NJT credentials.
 *
 *   npm run dev:fixture
 *
 * Refuses to write to the production volume or to any database that already
 * holds real observations.
 */
const dbPath = process.env.NJT_DB_PATH ?? "./data/dev.sqlite";

if (isProductionPath(dbPath)) {
  console.error(`Refusing to write fabricated data to ${dbPath} — that is the production volume.`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));

if (hasRealObservations(repos)) {
  console.error(
    `Refusing to run: ${dbPath} already holds real observations.\n` +
      "Point NJT_DB_PATH at a scratch file instead.",
  );
  process.exit(1);
}

// Enough history that two-period comparisons (trends) have both sides.
const days = Number(process.env.NJT_FIXTURE_DAYS ?? 35);
const result = buildDevFixture(repos, Date.now(), days);
console.log(`Wrote a development fixture to ${dbPath}:`);
console.log(`  ${result.events} events across ${result.days} days, ${result.upcoming} upcoming departures, 18 live vehicles.`);
console.log(`\nRun it:\n  NJT_DB_PATH=${dbPath} npm run api\n  EXPO_PUBLIC_API_URL=http://localhost:4000 npm run web --workspace app`);
