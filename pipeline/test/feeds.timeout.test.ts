import { describe, expect, it, vi } from "vitest";
import type { Clock } from "../src/clock";
import { loadConfig, type PipelineConfig } from "../src/config";
import {
  FEED_TIMEOUT_MS,
  GTFS_STATIC_TIMEOUT_MS,
  HttpFeedClient,
  TokenManager,
  type TokenStore,
} from "../src/feeds";
import { silentLogger } from "../src/logger";

/**
 * Every outbound NJT call had no deadline, which made a stalled feed
 * indistinguishable from a healthy one: the poller sat in a `fetch` that never
 * settled, and `/health` kept answering because the API is a separate process
 * and was fine. Ingest could stop for hours without anything reporting it.
 */

const BASE = "https://testraildata.njtransit.com/api/GTFSRT";

function config(): PipelineConfig {
  return loadConfig({
    NJT_RAIL_DATA_USERNAME: "user",
    NJT_RAIL_DATA_PASSWORD: "pass",
    NJT_RAIL_DATA_BASE_URL: BASE,
  });
}

const clock: Clock = { now: () => Date.UTC(2026, 6, 15, 12, 0, 0), sleep: () => Promise.resolve() };

function store(token = "tok"): TokenStore {
  let current: { token: string; fetchedAtMs: number } | null = { token, fetchedAtMs: clock.now() };
  return { read: () => current, write: (t, ms) => void (current = { token: t, fetchedAtMs: ms }) };
}

/** A server that accepts the connection and then never answers. */
function hangingFetch(seen: { signals: AbortSignal[] }): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal;
    seen.signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  }) as typeof fetch;
}

function feedClient(fetchImpl: typeof fetch) {
  const cfg = config();
  const tokens = new TokenManager(cfg, store(), fetchImpl, clock, silentLogger);
  return new HttpFeedClient(cfg, tokens, fetchImpl);
}

describe("outbound calls have a deadline", () => {
  it("abandons a real-time feed that never responds", async () => {
    vi.useFakeTimers();
    try {
      const seen = { signals: [] as AbortSignal[] };
      const pending = feedClient(hangingFetch(seen)).fetchTripUpdates();
      const assertion = expect(pending).rejects.toThrow(/getTripUpdates timed out after 15000ms/);

      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the call and the limit, rather than 'operation was aborted'", async () => {
    // The raw abort reason says neither, and a stall is diagnosed from logs.
    vi.useFakeTimers();
    try {
      const pending = feedClient(hangingFetch({ signals: [] })).fetchServiceAlerts();
      const assertion = expect(pending).rejects.toThrow("getAlerts timed out after 15000ms");
      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a signal on every request, so the deadline can be enforced at all", async () => {
    vi.useFakeTimers();
    try {
      const seen = { signals: [] as AbortSignal[] };
      const pending = feedClient(hangingFetch(seen)).fetchVehiclePositions();
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1);
      await assertion;

      expect(seen.signals).toHaveLength(1);
      expect(seen.signals[0]).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the static GTFS download far longer than a poll", async () => {
    // getGTFS ships the whole schedule as a zip; holding it to a poll's
    // deadline would abort a download that was progressing normally.
    vi.useFakeTimers();
    try {
      const pending = feedClient(hangingFetch({ signals: [] })).fetchGtfsStatic();
      const assertion = expect(pending).rejects.toThrow(/getGTFS timed out after 120000ms/);

      // Still running well past the real-time ceiling.
      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1_000);
      await vi.advanceTimersByTimeAsync(GTFS_STATIC_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a prompt response untouched", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const ok = (async () =>
      new Response(bytes.buffer as ArrayBuffer, {
        headers: { "content-type": "application/octet-stream" },
      })) as unknown as typeof fetch;

    await expect(feedClient(ok).fetchTripUpdates()).resolves.toEqual(bytes);
  });

  it("keeps the real-time deadline under the poll interval", () => {
    // Otherwise a stalled poll outlives the next one and they accumulate.
    expect(FEED_TIMEOUT_MS).toBeLessThan(30_000);
  });
});
