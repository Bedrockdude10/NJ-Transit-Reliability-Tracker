import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineSummaryResponse } from "@njt/shared";
import { ApiContractError, api, buildUrl } from "../api";

describe("buildUrl", () => {
  it("appends defined params and drops empty ones", () => {
    expect(buildUrl("/lines")).toBe("http://localhost:4000/lines");
    expect(buildUrl("/system/summary", { from: "2025-07-01", to: "2025-07-15", x: undefined })).toBe(
      "http://localhost:4000/system/summary?from=2025-07-01&to=2025-07-15",
    );
  });
});

/**
 * A response the real API could actually return. The previous fixture here was
 * `{ lines: [] }` — a shape `/lines/:id/summary` has never produced — and the
 * test passed regardless, because a type assertion cannot check what arrives
 * over the wire. Adding schema validation is what surfaced it.
 */
const emptyOtp = {
  tripsOperated: 0,
  tripsCancelled: 0,
  cancellationRatePercent: 0,
  avgDelaySeconds: 0,
  medianDelaySeconds: 0,
  p90DelaySeconds: 0,
  thresholds: [],
  delayDistribution: [],
};

const lineSummary: LineSummaryResponse = {
  lineId: "northeast-corridor",
  name: "Northeast Corridor Line",
  from: "2025-07-01",
  to: "2025-07-15",
  overall: emptyOtp,
  inbound: emptyOtp,
  outbound: emptyOtp,
  njtOfficial: null,
  njtCancellations: null,
  officialCoverage: null,
};

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the right URL and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => lineSummary });
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.lineSummary("NE", { from: "2025-07-01", to: "2025-07-15" }).run();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/lines/NE/summary?from=2025-07-01&to=2025-07-15");
    expect(result).toEqual(lineSummary);
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(api.health().run()).rejects.toThrow("API 500");
  });

  it("rejects a response that does not match the contract", async () => {
    // The deploy-skew case: the API drops or renames a field the app expects.
    const { name: _renamed, ...drifted } = lineSummary;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => drifted }));
    await expect(api.lineSummary("NE", {}).run()).rejects.toThrow(ApiContractError);
  });

  it("names the field that drifted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...lineSummary, name: 42 }),
    }));
    // Without the field name, a skew in production is a guessing game.
    await expect(api.lineSummary("NE", {}).run()).rejects.toThrow(/"name"/u);
  });

  it("tolerates a field the API has added", async () => {
    // Additive changes must not break an older app: zod strips unknown keys.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...lineSummary, somethingNew: "ignored" }),
    }));
    await expect(api.lineSummary("NE", {}).run()).resolves.toEqual(lineSummary);
  });

  it("builds a CSV export URL", () => {
    expect(api.exportUrl("line", { from: "2025-07-01", to: "2025-07-15" }, "NE")).toBe(
      "http://localhost:4000/export?entity=line&id=NE&from=2025-07-01&to=2025-07-15",
    );
  });
});

/**
 * Cache keys used to be hand-written dependency arrays at each call site, and
 * two of them had already collided: `systemSummary` and `lightRailSummary` were
 * both keyed `[range.from, range.to]`, so under a shared cache one screen could
 * have been served the other's data. Keys now come from the URL.
 */
describe("query keys", () => {
  const range = { from: "2025-07-01", to: "2025-07-15" };

  it("distinguishes endpoints that take the same arguments", () => {
    expect(api.systemSummary(range).key).not.toEqual(api.lightRailSummary(range).key);
  });

  it("distinguishes the same endpoint at different arguments", () => {
    expect(api.lineSummary("NE", range).key).not.toEqual(api.lineSummary("NJCL", range).key);
    expect(api.systemSummary(range).key).not.toEqual(
      api.systemSummary({ from: "2025-06-01", to: "2025-06-15" }).key,
    );
    // Same endpoint, same params, different type -> different data.
    expect(api.systemHeatmap(range, "hour_of_day").key).not.toEqual(
      api.systemHeatmap(range, "day_of_week").key,
    );
  });

  it("is stable for identical requests, so callers dedupe", () => {
    expect(api.lineSummary("NE", range).key).toEqual(api.lineSummary("NE", range).key);
  });

  it("is the URL that will actually be fetched", () => {
    expect(api.lineSummary("NE", range).key).toEqual([
      "http://localhost:4000/lines/NE/summary?from=2025-07-01&to=2025-07-15",
    ]);
  });
});
