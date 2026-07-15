import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "../src/clock";
import { loadConfig, type PipelineConfig } from "../src/config";
import { HttpFeedClient, TokenManager, type TokenStore } from "../src/feeds";
import { silentLogger } from "../src/logger";

const BASE = "https://testraildata.njtransit.com/api/GTFSRT";

function config(): PipelineConfig {
  return loadConfig({
    NJT_RAIL_DATA_USERNAME: "user",
    NJT_RAIL_DATA_PASSWORD: "pass",
    NJT_RAIL_DATA_BASE_URL: BASE,
  });
}

function memoryStore(seed: { token: string; fetchedAtMs: number } | null = null): TokenStore {
  let current = seed;
  return {
    read: () => current,
    write: (token, fetchedAtMs) => {
      current = { token, fetchedAtMs };
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function protoResponse(bytes: Uint8Array): Response {
  return new Response(bytes.buffer as ArrayBuffer, { headers: { "content-type": "application/octet-stream" } });
}

let clockNow = Date.UTC(2026, 6, 15, 12, 0, 0);
const clock: Clock = { now: () => clockNow, sleep: () => Promise.resolve() };

describe("TokenManager", () => {
  beforeEach(() => {
    clockNow = Date.UTC(2026, 6, 15, 12, 0, 0);
  });

  it("fetches, caches, and reuses a token without re-calling getToken", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ Authenticated: "True", UserToken: "TOK1" }),
    );
    const tokens = new TokenManager(config(), memoryStore(), fetchImpl as unknown as typeof fetch, clock, silentLogger);

    expect(await tokens.get()).toBe("TOK1");
    expect(await tokens.get()).toBe("TOK1"); // served from cache
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE}/getToken`);
    expect((init as RequestInit).method).toBe("POST");
    const form = (init as RequestInit).body as FormData;
    expect(form.get("username")).toBe("user");
    expect(form.get("password")).toBe("pass");
  });

  it("reuses a persisted token across restarts", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Authenticated: "True", UserToken: "NEW" }));
    const store = memoryStore({ token: "PERSISTED", fetchedAtMs: clockNow - 60_000 });
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);

    expect(await tokens.get()).toBe("PERSISTED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes a stale token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Authenticated: "True", UserToken: "FRESH" }));
    const store = memoryStore({ token: "OLD", fetchedAtMs: clockNow - 21 * 60 * 60 * 1000 });
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);

    expect(await tokens.get()).toBe("FRESH");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent refreshes into one getToken call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Authenticated: "True", UserToken: "TOK" }));
    const tokens = new TokenManager(config(), memoryStore(), fetchImpl as unknown as typeof fetch, clock, silentLogger);

    const [a, b, c] = await Promise.all([tokens.get(), tokens.get(), tokens.get()]);
    expect([a, b, c]).toEqual(["TOK", "TOK", "TOK"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on a null response (missing credentials)", async () => {
    const fetchImpl = vi.fn(async () => new Response("null", { headers: { "content-type": "application/json" } }));
    const tokens = new TokenManager(config(), memoryStore(), fetchImpl as unknown as typeof fetch, clock, silentLogger);
    await expect(tokens.get()).rejects.toThrow(/null/);
  });

  it("surfaces the daily-usage error message", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errorMessage: "Daily usage limit:10. Your current daily usage: 11" }));
    const tokens = new TokenManager(config(), memoryStore(), fetchImpl as unknown as typeof fetch, clock, silentLogger);
    await expect(tokens.get()).rejects.toThrow(/Daily usage limit/);
  });

  it("throws when the config lacks credentials", async () => {
    const tokens = new TokenManager(loadConfig({}), memoryStore(), vi.fn() as unknown as typeof fetch, clock, silentLogger);
    await expect(tokens.get()).rejects.toThrow(/credentials are not configured/);
  });
});

describe("HttpFeedClient", () => {
  beforeEach(() => {
    clockNow = Date.UTC(2026, 6, 15, 12, 0, 0);
  });

  it("POSTs the token and returns proto bytes", async () => {
    const proto = new Uint8Array([1, 2, 3, 4]);
    const store = memoryStore({ token: "TOK", fetchedAtMs: clockNow });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => protoResponse(proto));
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);
    const client = new HttpFeedClient(config(), tokens, fetchImpl as unknown as typeof fetch);

    const bytes = await client.fetchTripUpdates();
    expect(bytes).toEqual(proto);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE}/getTripUpdates`);
    expect(((init as RequestInit).body as FormData).get("token")).toBe("TOK");
  });

  it("refreshes the token once and retries on 'Invalid token'", async () => {
    const proto = new Uint8Array([9, 9]);
    const store = memoryStore({ token: "STALE", fetchedAtMs: clockNow });
    const getToken = vi.fn(async () => jsonResponse({ Authenticated: "True", UserToken: "REFRESHED" }));

    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/getToken")) return getToken();
      const token = (init.body as FormData).get("token");
      return token === "REFRESHED" ? protoResponse(proto) : jsonResponse({ errorMessage: "Invalid token." });
    });

    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);
    const client = new HttpFeedClient(config(), tokens, fetchImpl as unknown as typeof fetch);

    expect(await client.fetchVehiclePositions()).toEqual(proto);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("fetchGtfsStatic POSTs the token to getGTFS and returns the zip bytes", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK zip magic
    const store = memoryStore({ token: "TOK", fetchedAtMs: clockNow });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => protoResponse(zip));
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);
    const client = new HttpFeedClient(config(), tokens, fetchImpl as unknown as typeof fetch);

    expect(await client.fetchGtfsStatic()).toEqual(zip);
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/getGTFS`);
  });

  it("throws on a non-token JSON error", async () => {
    const store = memoryStore({ token: "TOK", fetchedAtMs: clockNow });
    const fetchImpl = vi.fn(async () => jsonResponse({ errorMessage: "Something else" }));
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);
    const client = new HttpFeedClient(config(), tokens, fetchImpl as unknown as typeof fetch);

    await expect(client.fetchServiceAlerts()).rejects.toThrow(/Something else/);
  });

  it("throws if the token is still invalid after a refresh", async () => {
    const store = memoryStore({ token: "TOK", fetchedAtMs: clockNow });
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/getToken")
        ? jsonResponse({ Authenticated: "True", UserToken: "NEW" })
        : jsonResponse({ errorMessage: "Invalid token." }),
    );
    const tokens = new TokenManager(config(), store, fetchImpl as unknown as typeof fetch, clock, silentLogger);
    const client = new HttpFeedClient(config(), tokens, fetchImpl as unknown as typeof fetch);

    await expect(client.fetchTripUpdates()).rejects.toThrow(/invalid token after refresh/);
  });
});
