import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createRepositories, openDatabase } from "@njt/db";
import { createApp } from "./app";

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const port = Number(process.env.PORT ?? 4000);

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));
const app = createApp(repos);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`NJT Reliability API listening on http://localhost:${info.port}`);
});
