import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import { type Logger, consoleLogger } from "./logger";

/**
 * Fetches raw bytes from the NJT real-time feeds. The interface is what the
 * ingestor depends on, so tests inject a fake instead of hitting the network.
 */
export interface FeedClient {
  fetchTripUpdates(): Promise<Uint8Array>;
  fetchVehiclePositions(): Promise<Uint8Array>;
  fetchServiceAlerts(): Promise<Uint8Array>;
}

/**
 * Persists the daily API token across process restarts. Backed by
 * `pipeline_meta` in production so a redeploy doesn't burn the getToken quota.
 */
export interface TokenStore {
  read(): { token: string; fetchedAtMs: number } | null;
  write(token: string, fetchedAtMs: number): void;
}

/**
 * Refresh the cached token proactively once it's older than this. NJT caps
 * getToken at 10 calls/day and recommends calling it ~once/day, so we keep a
 * wide margin under the daily rollover (tokens are minted per calendar day).
 */
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;

interface GetTokenResponse {
  Authenticated?: string;
  UserToken?: string;
  errorMessage?: string;
}

/**
 * Acquires and caches the NJT rail-data token. POSTs username/password to
 * `getToken` (multipart/form-data) and stores `{ UserToken }`. Concurrent
 * refreshes are de-duped so the three feeds polling at once spend one call.
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

  /** Return a usable token, refreshing if stale or `force` is set. */
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
    const res = await this.fetchImpl(`${baseUrl}/getToken`, {
      method: "POST",
      body: form,
      headers: { accept: "text/plain" },
    });
    if (!res.ok) throw new Error(`getToken failed: ${res.status} ${res.statusText}`);

    // Returns `null` when credentials are missing, else a JSON envelope.
    const data = (await res.json().catch(() => null)) as GetTokenResponse | null;
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
 * HTTP feed client for NJT's token-based GTFS-RT Web API. Each feed is a POST
 * with a `token` form field; success returns protobuf bytes
 * (`application/octet-stream`), while errors return a small JSON body. On an
 * "Invalid token" response it refreshes the token once and retries.
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

  /**
   * Download NJT's own GTFS static zip (getGTFS). Ingesting this — rather than a
   * third-party mirror — is what makes the real-time feed's numeric trip/stop
   * ids resolve against the static network.
   */
  fetchGtfsStatic(): Promise<Uint8Array> {
    return this.fetchProto("getGTFS");
  }

  private async fetchProto(method: string): Promise<Uint8Array> {
    const first = await this.post(method, await this.tokens.get());
    if (first !== INVALID_TOKEN) return first;

    // Token was rejected (expired/rotated) — mint a fresh one and retry once.
    const retry = await this.post(method, await this.tokens.get(true));
    if (retry === INVALID_TOKEN) throw new Error(`${method}: invalid token after refresh`);
    return retry;
  }

  private async post(method: string, token: string): Promise<Uint8Array | typeof INVALID_TOKEN> {
    const form = new FormData();
    form.append("token", token);
    const res = await this.fetchImpl(`${this.config.railData.baseUrl}/${method}`, {
      method: "POST",
      body: form,
      headers: { accept: "*/*" },
    });
    if (!res.ok) throw new Error(`${method} failed: ${res.status} ${res.statusText}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    // Proto payloads are binary; any JSON/text body is an error envelope.
    if (contentType.includes("octet-stream") || contentType.includes("protobuf")) return bytes;

    const text = new TextDecoder().decode(bytes).trim();
    if (/invalid token/i.test(text) || text === "" || text.toLowerCase() === "null") return INVALID_TOKEN;
    throw new Error(`${method} error: ${text.slice(0, 200)}`);
  }
}
