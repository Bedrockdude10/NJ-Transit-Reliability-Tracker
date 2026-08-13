/**
 * Tiny request cache + in-flight de-duplicator for the read-only API client.
 *
 * Two problems it solves:
 *  - **Dedup:** several components mounting in the same frame (e.g. a screen and
 *    the global footer both asking for `/health`) share one in-flight request
 *    instead of each firing their own.
 *  - **Cache:** a resolved response is reused for a short TTL, so navigating back
 *    to a screen — or re-running an effect over a list of ids where only one
 *    changed — hits at most one network request per key.
 *
 * The API is read-only (see CLAUDE.md), so caching GETs by URL is safe.
 * Rejections are never cached, so a failed request retries on the next call.
 */
export interface RequestCacheOptions {
  /** How long a resolved value stays fresh. Default 30s. */
  ttlMs?: number;
  /** Clock injection for tests. Default `Date.now`. */
  now?: () => number;
}

export class RequestCache {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fresh = new Map<string, { value: unknown; storedAtMs: number }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: RequestCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Return a still-fresh cached value, share a pending request if one exists
   * (dedup), or start a new one via `factory`. Rejections are not cached.
   */
  get<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.fresh.get(key);
    if (cached && this.now() - cached.storedAtMs < this.ttlMs) {
      return Promise.resolve(cached.value as T);
    }

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = factory()
      .then((value) => {
        this.fresh.set(key, { value, storedAtMs: this.now() });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Like {@link get}, but never serves or stores a cached value — for endpoints
   * whose whole point is being current (the departure board, live vehicle
   * positions). Concurrent callers still share one in-flight request, so a
   * screen and a widget asking at the same moment don't double-fetch; a board
   * refreshing on a timer simply always gets a fresh answer.
   */
  live<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = factory().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Drop a single key's cached value and any in-flight tracking. */
  invalidate(key: string): void {
    this.fresh.delete(key);
    this.inflight.delete(key);
  }

  /** Clear everything (primarily for tests). */
  clear(): void {
    this.fresh.clear();
    this.inflight.clear();
  }
}
