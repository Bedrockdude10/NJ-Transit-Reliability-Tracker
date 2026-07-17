import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import type { Hono } from "hono";
import { createApp } from "../src/app";
import { SEED_DATE, seedFixture } from "../src/dev/fixture";

export { SEED_DATE };

/**
 * Build an API over an in-memory db seeded with one day of realistic data. The
 * fixture itself lives in `api/src/dev/fixture.ts` so the `npm run dev:seed` CLI
 * and these tests share a single definition of "populated data".
 */
export function seededApp(): { app: Hono; repos: Repositories } {
  const repos = createRepositories(openDatabase());
  seedFixture(repos);
  return { app: createApp(repos), repos };
}
