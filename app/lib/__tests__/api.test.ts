import { afterEach, describe, expect, it, vi } from "vitest";
import { api, buildUrl } from "../api";

describe("buildUrl", () => {
  it("appends defined params and drops empty ones", () => {
    expect(buildUrl("/lines")).toBe("http://localhost:4000/lines");
    expect(buildUrl("/system/summary", { from: "2025-07-01", to: "2025-07-15", x: undefined })).toBe(
      "http://localhost:4000/system/summary?from=2025-07-01&to=2025-07-15",
    );
  });
});

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the right URL and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lines: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.lineSummary("NE", { from: "2025-07-01", to: "2025-07-15" });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/lines/NE/summary?from=2025-07-01&to=2025-07-15");
    expect(result).toEqual({ lines: [] });
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(api.health()).rejects.toThrow("API 500");
  });

  it("builds a CSV export URL", () => {
    expect(api.exportUrl("line", { from: "2025-07-01", to: "2025-07-15" }, "NE")).toBe(
      "http://localhost:4000/export?entity=line&id=NE&from=2025-07-01&to=2025-07-15",
    );
  });
});
