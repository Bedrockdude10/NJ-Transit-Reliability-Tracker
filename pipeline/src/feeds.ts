import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import { type Logger, consoleLogger } from "@njt/shared/logger";

export interface FeedClient {
  fetchTripUpdates(): Promise<Uint8Array>;
  fetchVehiclePositions(): Promise<Uint8Array>;
  fetchServiceAlerts(): Promise<Uint8Array>;
}

/** Backed by `pipeline_meta` in production so a redeploy doesn't burn the getToken quota. */
export interface TokenStore {
  read(): { token: string; fetchedAtMs: number } | null;
  write(token: string, fetchedAtMs: number): void;
}

/** NJT caps getToken at 10 calls/day; tokens are minted per calendar day. */
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;

/**
 * Without a deadline a hung connection stalls ingest silently while `/health` still
 * returns 200. Sits below the poll interval so stalled polls don't accumulate.
 */
export const FEED_TIMEOUT_MS = 15_000;

/** getGTFS ships the entire static schedule as a zip. */
export const GTFS_STATIC_TIMEOUT_MS = 120_000;

/**
 * `setTimeout` + `AbortController` rather than `AbortSignal.timeout`: the built-in's
 * timer cannot be advanced by fake timers. The abort reason names the call and limit,
 * since the default is a bare "This operation was aborted".
 */
async function withDeadline<T>(
  label: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const expired = new Error(`${label} timed out after ${timeoutMs}ms`);
  const timer = setTimeout(() => controller.abort(expired), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    // Any failure after the deadline is the deadline, however `fetch` reported it.
    throw controller.signal.aborted ? expired : error;
  } finally {
    clearTimeout(timer);
  }
}

interface GetTokenResponse {
  Authenticated?: string;
  UserToken?: string;
  errorMessage?: string;
}

/**
 * POSTs username/password to `getToken` as multipart/form-data. Concurrent refreshes
 * are de-duped so the three feeds polling at once spend one call against the quota.
 */
export class TokenManager {
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly config: PipelineConfig,
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: Clock = systemClock,
    private readonly logger: Logger = consoleLogger,
  ) {}

  async get(force = false): Promise<string> {
    if (!force) {
      const cached = this.store.read();
      if (cached && this.clock.now() - cached.fetchedAtMs < TOKEN_TTL_MS) return cached.token;
    }
    if (!this.inFlight) {
      this.inFlight = this.request().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async request(): Promise<string> {
    const { username, password, baseUrl } = this.config.railData;
    if (!username || !password) throw new Error("NJT rail-data credentials are not configured");

    const form = new FormData();
    form.append("username", username);
    form.append("password", password);
    const data = await withDeadline("getToken", FEED_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${baseUrl}/getToken`, {
        method: "POST",
        body: form,
        headers: { accept: "text/plain" },
        signal,
      });
      if (!res.ok) throw new Error(`getToken failed: ${res.status} ${res.statusText}`);
      // getToken returns bare `null` when credentials are missing.
      return (await res.json().catch(() => null)) as GetTokenResponse | null;
    });
    if (!data) throw new Error("getToken returned null (missing or unrecognized credentials)");
    if (data.errorMessage) throw new Error(`getToken error: ${data.errorMessage}`);
    if (data.Authenticated !== "True" || !data.UserToken) throw new Error("getToken authentication failed");

    this.store.write(data.UserToken, this.clock.now());
    this.logger.info("njt token refreshed");
    return data.UserToken;
  }
}

/** Sentinel: a feed call came back as "Invalid token" rather than proto bytes. */
const INVALID_TOKEN = Symbol("invalid-token");

/**
 * Each feed is a POST with a `token` form field; success returns protobuf bytes,
 * errors return a small JSON/text body with HTTP 200.
 */
export class HttpFeedClient implements FeedClient {
  constructor(
    private readonly config: PipelineConfig,
    private readonly tokens: TokenManager,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  fetchTripUpdates(): Promise<Uint8Array> {
    return this.fetchProto("getTripUpdates");
  }
  fetchVehiclePositions(): Promise<Uint8Array> {
    return this.fetchProto("getVehiclePositions");
  }
  fetchServiceAlerts(): Promise<Uint8Array> {
    return this.fetchProto("getAlerts");
  }

  fetchGtfsStatic(): Promise<Uint8Array> {
    return this.fetchProto("getGTFS", GTFS_STATIC_TIMEOUT_MS);
  }

  private async fetchProto(method: string, timeoutMs = FEED_TIMEOUT_MS): Promise<Uint8Array> {
    const first = await this.post(method, await this.tokens.get(), timeoutMs);
    if (first !== INVALID_TOKEN) return first;

    const retry = await this.post(method, await this.tokens.get(true), timeoutMs);
    if (retry === INVALID_TOKEN) throw new Error(`${method}: invalid token after refresh`);
    return retry;
  }

  private async post(
    method: string,
    token: string,
    timeoutMs: number,
  ): Promise<Uint8Array | typeof INVALID_TOKEN> {
    const form = new FormData();
    form.append("token", token);
    // The deadline covers reading the body too: a half-stalled download is a stall.
    const { bytes, contentType } = await withDeadline(method, timeoutMs, async (signal) => {
      const res = await this.fetchImpl(`${this.config.railData.baseUrl}/${method}`, {
        method: "POST",
        body: form,
        headers: { accept: "*/*" },
        signal,
      });
      if (!res.ok) throw new Error(`${method} failed: ${res.status} ${res.statusText}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "",
      };
    });
    if (contentType.includes("octet-stream") || contentType.includes("protobuf")) return bytes;

    const text = new TextDecoder().decode(bytes).trim();
    if (/invalid token/i.test(text) || text === "" || text.toLowerCase() === "null") return INVALID_TOKEN;
    throw new Error(`${method} error: ${text.slice(0, 200)}`);
  }
}
