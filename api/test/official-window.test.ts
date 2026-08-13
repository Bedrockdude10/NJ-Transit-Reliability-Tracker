import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOfficialWindow } from "../src/official-window";

const REQUESTED = { from: { year: 2026, month: 7 }, to: { year: 2026, month: 8 } };

interface Row {
  year: number;
  month: number;
  value: number;
}

/** A tiny in-memory store behaving like the monthly repositories. */
function store(rows: Row[]) {
  const index = (y: number, m: number) => y * 12 + m;
  return {
    fetch: vi.fn((from: { year: number; month: number }, to: { year: number; month: number }) =>
      rows.filter((r) => index(r.year, r.month) >= index(from.year, from.month) && index(r.year, r.month) <= index(to.year, to.month)),
    ),
    latest: vi.fn(() => {
      if (rows.length === 0) return null;
      const newest = rows.reduce((a, b) => (index(b.year, b.month) > index(a.year, a.month) ? b : a));
      return { year: newest.year, month: newest.month };
    }),
  };
}

describe("resolveOfficialWindow", () => {
  let published: ReturnType<typeof store>;
  beforeEach(() => {
    // NJT's real posture: published through 2026-05, request asks for Jul–Aug.
    published = store([
      { year: 2026, month: 4, value: 1 },
      { year: 2026, month: 5, value: 2 },
    ]);
  });

  it("falls back to the newest published month when the range has none", () => {
    const result = resolveOfficialWindow(REQUESTED, published.fetch, published.latest);
    expect(result.metrics).toEqual([{ year: 2026, month: 5, value: 2 }]);
    expect(result.coverage).toEqual({ fromMonth: "2026-05", toMonth: "2026-05", outsideRequestedRange: true });
  });

  it("uses the requested range when it does contain published months", () => {
    const inRange = { from: { year: 2026, month: 4 }, to: { year: 2026, month: 5 } };
    const result = resolveOfficialWindow(inRange, published.fetch, published.latest);
    expect(result.metrics).toHaveLength(2);
    expect(result.coverage).toEqual({ fromMonth: "2026-04", toMonth: "2026-05", outsideRequestedRange: false });
    expect(published.latest).not.toHaveBeenCalled(); // no fallback query
  });

  it("reports coverage from the rows, not the requested bounds", () => {
    // A wide request that only partially overlaps published history.
    const wide = { from: { year: 2020, month: 1 }, to: { year: 2026, month: 12 } };
    expect(resolveOfficialWindow(wide, published.fetch, published.latest).coverage).toEqual({
      fromMonth: "2026-04",
      toMonth: "2026-05",
      outsideRequestedRange: false,
    });
  });

  it("returns null coverage when nothing has ever been published", () => {
    const empty = store([]);
    const result = resolveOfficialWindow(REQUESTED, empty.fetch, empty.latest);
    expect(result).toEqual({ metrics: [], coverage: null });
  });

  it("returns null coverage when the latest month yields no rows", () => {
    // Defensive: `latest` and `fetch` disagreeing must not produce a bogus window.
    const inconsistent = { fetch: vi.fn(() => [] as Row[]), latest: vi.fn(() => ({ year: 2026, month: 5 })) };
    expect(resolveOfficialWindow(REQUESTED, inconsistent.fetch, inconsistent.latest)).toEqual({
      metrics: [],
      coverage: null,
    });
  });
});
