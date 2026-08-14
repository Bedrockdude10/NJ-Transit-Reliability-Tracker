import { type Clock, systemClock } from "./clock";
import type { PipelineConfig } from "./config";
import { type Logger, consoleLogger } from "@njt/shared/logger";

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

/**
 * Ceilings on how long a single outbound NJT call may take.
 *
 * Without them a hung connection stalls ingest indefinitely and nothing
 * notices: the poller sits in a `fetch` that never settles while `/health`
 * keeps answering, because the API is a separate process and perfectly fine.
 * A stalled feed therefore looked exactly like a healthy one.
 *
 * The real-time ceiling sits below the poll interval on purpose, so a stalled
 * poll is abandoned before the next is due rather than accumulating.
 */
export const FEED_TIMEOUT_MS = 15_000;

/** getGTFS ships the entire static schedule as a zip, so it needs far longer. */
export const GTFS_STATIC_TIMEOUT_MS = 120_000;

/**
 * Run an outbound call under a deadline, and say so plainly if it expires.
 *
 * The deadline is an `AbortController` driven by `setTimeout` rather than
 * `AbortSignal.timeout`, which reads slightly worse but is testable: the
 * built-in uses an internal timer that fake timers cannot advance, so a
 * deadline built on it could only be verified by actually waiting fifteen
 * seconds.
 *
 * The abort reason carries the message, because the default surfaces as "This
 * operation was aborted" — naming neither the call nor the limit, and
 * diagnosing a stall from logs is the whole point of having a deadline.
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
    // Any failure once the deadline has passed is the deadline, however `fetch`
    // chose to report it.
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
    const data = await withDeadline("getToken", FEED_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${baseUrl}/getToken`, {
        method: "POST",
        body: form,
        headers: { accept: "text/plain" },
        signal,
      });
      if (!res.ok) throw new Error(`getToken failed: ${res.status} ${res.statusText}`);
      // Returns `null` when credentials are missing, else a JSON envelope.
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
    return this.fetchProto("getGTFS", GTFS_STATIC_TIMEOUT_MS);
  }

  private async fetchProto(method: string, timeoutMs = FEED_TIMEOUT_MS): Promise<Uint8Array> {
    const first = await this.post(method, await this.tokens.get(), timeoutMs);
    if (first !== INVALID_TOKEN) return first;

    // Token was rejected (expired/rotated) — mint a fresh one and retry once.
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
    // The deadline covers reading the body, not just opening the response: a
    // download that stalls halfway is the same stall as one that never starts.
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
    // Proto payloads are binary; any JSON/text body is an error envelope.
    if (contentType.includes("octet-stream") || contentType.includes("protobuf")) return bytes;

    const text = new TextDecoder().decode(bytes).trim();
    if (/invalid token/i.test(text) || text === "" || text.toLowerCase() === "null") return INVALID_TOKEN;
    throw new Error(`${method} error: ${text.slice(0, 200)}`);
  }
}
