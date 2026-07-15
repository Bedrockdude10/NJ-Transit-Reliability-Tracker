import type { OfficialNjtMetric } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const LINE = "Northeast Corridor Line";

function metric(year: number, month: number, otp: number): OfficialNjtMetric {
  return {
    year,
    month,
    lineName: LINE,
    otpPercent: otp,
    otpPercentAmtrakAdjusted: null,
    tripsOperated: 100,
    cancellations: 0,
    cancellationCauses: null,
  };
}

describe("OfficialMetricRepository month-index range", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    // Nov 2024 .. Feb 2025, spanning the December → January year boundary.
    for (const [y, m, otp] of [
      [2024, 11, 80],
      [2024, 12, 81],
      [2025, 1, 82],
      [2025, 2, 83],
    ] as const) {
      repos.official.upsert(metric(y, m, otp));
    }
    repos.official.upsertMdbf({ year: 2024, month: 12, mdbf: 90000 });
    repos.official.upsertMdbf({ year: 2025, month: 1, mdbf: 91000 });
  });

  it("includes both endpoints of the range (inclusive)", () => {
    const rows = repos.official.getForLineRange(LINE, { year: 2024, month: 12 }, { year: 2025, month: 1 });
    expect(rows.map((r) => [r.year, r.month])).toEqual([
      [2024, 12],
      [2025, 1],
    ]);
  });

  it("handles the December → January wraparound without pulling adjacent months", () => {
    // A range of exactly one month around the year boundary must not spill into
    // Nov 2024 or Feb 2025, which are numerically close on `month` alone.
    const dec = repos.official.getForLineRange(LINE, { year: 2024, month: 12 }, { year: 2024, month: 12 });
    expect(dec.map((r) => [r.year, r.month])).toEqual([[2024, 12]]);

    const jan = repos.official.getForLineRange(LINE, { year: 2025, month: 1 }, { year: 2025, month: 1 });
    expect(jan.map((r) => [r.year, r.month])).toEqual([[2025, 1]]);
  });

  it("applies the same inclusive range to the system rollup and MDBF", () => {
    const all = repos.official.getAllForRange({ year: 2024, month: 12 }, { year: 2025, month: 1 });
    expect(all.map((r) => [r.year, r.month])).toEqual([
      [2024, 12],
      [2025, 1],
    ]);

    const mdbf = repos.official.getMdbfForRange({ year: 2024, month: 12 }, { year: 2025, month: 1 });
    expect(mdbf.map((r) => [r.year, r.month])).toEqual([
      [2024, 12],
      [2025, 1],
    ]);
  });
});
