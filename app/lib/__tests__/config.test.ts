import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `config.ts` reads `EXPO_PUBLIC_API_URL` at module-load time, so each case
 * stubs the env and re-imports the module in isolation.
 */
describe("API_BASE_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the local dev API on port 4000 (matches api/src/main.ts)", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", undefined);
    vi.resetModules();
    const { API_BASE_URL } = await import("../config");
    expect(API_BASE_URL).toBe("http://localhost:4000");
  });

  it("uses the configured URL and strips trailing slashes", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example.com///");
    vi.resetModules();
    const { API_BASE_URL } = await import("../config");
    expect(API_BASE_URL).toBe("https://api.example.com");
  });
});
