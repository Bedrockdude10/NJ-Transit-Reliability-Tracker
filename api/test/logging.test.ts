import { createRepositories, openDatabase } from "@njt/db";
import type { Logger } from "@njt/shared/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * The API logged almost nothing. A 500 produced `console.error("Unhandled API
 * error:", err)` — no method, no path, no query — so an error in the logs could
 * not be tied to a request, let alone reproduced. Outage #2 was diagnosed by
 * reading raw supervisor output and guessing.
 */

interface Entry {
  level: string;
  message: string;
  meta: Record<string, unknown>;
}

function recorder(): { entries: Entry[]; logger: Logger } {
  const entries: Entry[] = [];
  const push = (level: string) => (message: string, meta: Record<string, unknown> = {}) =>
    void entries.push({ level, message, meta });
  return { entries, logger: { info: push("info"), warn: push("warn"), error: push("error") } };
}

describe("api logging", () => {
  let rec: ReturnType<typeof recorder>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    rec = recorder();
    app = createApp(createRepositories(openDatabase()), rec.logger);
  });

  it("records every request with its status and duration", async () => {
    await app.request("/health");
    const request = rec.entries.find((e) => e.message === "request");
    expect(request).toBeDefined();
    if (request === undefined) throw new Error("expected a request log entry");
    expect(request.meta).toMatchObject({ method: "GET", path: "/health", status: 200 });
    expect(typeof request.meta.durationMs).toBe("number");
  });

  it("records the status of a request that was refused", async () => {
    await app.request("/lines/nope/summary");
    const request = rec.entries.find((e) => e.message === "request");
    if (request === undefined) throw new Error("expected a request log entry");
    expect(request.meta.status).toBe(404);
  });

  it("does not treat a deliberate 4xx as an incident", async () => {
    // A 404 is an answer. Logging it at error level trains people to ignore
    // error logs, which is worse than not having them.
    await app.request("/lines/nope/summary");
    expect(rec.entries.filter((e) => e.level === "error")).toHaveLength(0);
  });

  it("names the endpoint when a request fails unexpectedly", async () => {
    const boom = createApp(createRepositories(openDatabase()), rec.logger);
    boom.get("/explode", () => {
      throw new Error("kaboom");
    });

    const res = await boom.request("/explode?who=me");
    expect(res.status).toBe(500);

    const failure = rec.entries.find((e) => e.level === "error");
    expect(failure).toBeDefined();
    if (failure === undefined) throw new Error("expected an error log entry");
    expect(failure.meta).toMatchObject({ method: "GET", path: "/explode", query: "who=me", error: "kaboom" });
    // Without a stack the log says something broke but not where.
    expect(failure.meta.stack).toBeTruthy();
  });

  it("still hides the internal detail from the response body", async () => {
    const boom = createApp(createRepositories(openDatabase()), rec.logger);
    boom.get("/explode", () => {
      throw new Error("connection string with a password in it");
    });

    const body = await (await boom.request("/explode")).json();
    expect(body).toEqual({ error: "Internal server error" });
  });
});
