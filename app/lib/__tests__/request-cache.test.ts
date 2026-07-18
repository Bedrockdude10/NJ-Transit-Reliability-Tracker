import { describe, expect, it, vi } from "vitest";
import { RequestCache } from "../request-cache";

describe("RequestCache", () => {
  it("dedups concurrent in-flight requests for the same key", async () => {
    const cache = new RequestCache();
    const factory = vi.fn(async () => "value");
    const [a, b] = await Promise.all([cache.get("k", factory), cache.get("k", factory)]);
    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh cached value without re-invoking the factory", async () => {
    const cache = new RequestCache({ ttlMs: 1000, now: () => 0 });
    const factory = vi.fn(async () => "v1");
    expect(await cache.get("k", factory)).toBe("v1");
    expect(await cache.get("k", factory)).toBe("v1");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    let clock = 0;
    const cache = new RequestCache({ ttlMs: 1000, now: () => clock });
    let n = 0;
    const factory = vi.fn(async () => `v${++n}`);
    expect(await cache.get("k", factory)).toBe("v1");
    clock = 1500; // past the TTL
    expect(await cache.get("k", factory)).toBe("v2");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not cache rejections — the next call retries", async () => {
    const cache = new RequestCache();
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(cache.get("k", factory)).rejects.toThrow("boom");
    expect(await cache.get("k", factory)).toBe("ok");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("keys entries independently", async () => {
    const cache = new RequestCache();
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    expect(await cache.get("a", a)).toBe("a");
    expect(await cache.get("b", b)).toBe("b");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("invalidate() forces a refetch for one key", async () => {
    const cache = new RequestCache({ ttlMs: 10_000, now: () => 0 });
    let n = 0;
    const factory = vi.fn(async () => `v${++n}`);
    expect(await cache.get("k", factory)).toBe("v1");
    cache.invalidate("k");
    expect(await cache.get("k", factory)).toBe("v2");
  });
});
