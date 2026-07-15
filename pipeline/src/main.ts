import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRepositories, openDatabase } from "@njt/db";
import { systemClock } from "./clock";
import { loadConfig } from "./config";
import { HttpFeedClient, TokenManager, type TokenStore } from "./feeds";
import { Ingestor } from "./ingestor";
import { consoleLogger } from "./logger";
import { RateLimiter } from "./rate-limiter";
import { startScheduler } from "./scheduler";

async function main(): Promise<void> {
  // Best-effort .env load (Node 25 built-in); ignored if the file is absent.
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env — rely on the real environment */
  }

  const config = loadConfig();
  mkdirSync(dirname(config.dbPath), { recursive: true });

  const db = openDatabase(config.dbPath);
  const repos = createRepositories(db);
  const rateLimiter = new RateLimiter(repos.health);

  // Token cached in pipeline_meta so redeploys don't spend the getToken quota.
  const tokenStore: TokenStore = {
    read() {
      const raw = repos.health.getMeta("njt_rail_token");
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { token: string; fetchedAtMs: number };
        return parsed.token ? parsed : null;
      } catch {
        return null;
      }
    },
    write(token, fetchedAtMs) {
      repos.health.setMeta("njt_rail_token", JSON.stringify({ token, fetchedAtMs }));
    },
  };
  const tokens = new TokenManager(config, tokenStore, fetch, systemClock, consoleLogger);
  const client = new HttpFeedClient(config, tokens);
  const ingestor = new Ingestor({ repos, client, config, rateLimiter, logger: consoleLogger });

  // One-time syncs at startup, if configured.
  if (config.urls.gtfsStatic) {
    try {
      const res = await fetch(config.urls.gtfsStatic);
      ingestor.syncGtfsStatic(new Uint8Array(await res.arrayBuffer()));
    } catch (error) {
      consoleLogger.error("startup GTFS static sync failed", { error: String(error) });
    }
  }
  if (config.urls.officialCsv) {
    try {
      const res = await fetch(config.urls.officialCsv);
      ingestor.importOfficialMetrics(await res.text());
    } catch (error) {
      consoleLogger.error("startup official metrics import failed", { error: String(error) });
    }
  }

  const scheduler = startScheduler(ingestor, rateLimiter, config);
  consoleLogger.info("pipeline started", { dbPath: config.dbPath });

  const shutdown = (signal: string): void => {
    consoleLogger.info("shutting down", { signal });
    scheduler.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  consoleLogger.error("pipeline crashed", { error: String(error) });
  process.exit(1);
});
