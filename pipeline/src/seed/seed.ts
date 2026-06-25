import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { generateSyntheticData } from "./generate";

/** CLI: populate a database with synthetic data for local dev / demo. */
const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const days = Number(process.env.SEED_DAYS ?? 45);

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));
const result = generateSyntheticData(repos, { days });

console.log(`Seeded ${result.events} events across ${result.days} days into ${dbPath}`);
