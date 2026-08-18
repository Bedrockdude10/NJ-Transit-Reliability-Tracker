import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createRepositories, openDatabase } from "@njt/db";
import { consoleLogger as log } from "@njt/shared/logger";
import { createApp } from "./app";

const dbPath = process.env.NJT_DB_PATH ?? "./data/njt.sqlite";
const port = Number(process.env.PORT ?? 4000);

/**
 * Log and exit rather than continue: the supervisor restarts the process, and a
 * half-initialised API serving wrong answers is worse than one briefly absent.
 */
for (const fatal of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(fatal, (error: unknown) => {
    log.error(`fatal: ${fatal}`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}

mkdirSync(dirname(dbPath), { recursive: true });
const repos = createRepositories(openDatabase(dbPath));
const app = createApp(repos);

serve({ fetch: app.fetch, port }, (info) => {
  log.info("api listening", { port: info.port, dbPath });
});
