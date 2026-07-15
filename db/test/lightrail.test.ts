import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

const HBLR = "Hudson-Bergen Light Rail";

describe("LightRailRepository month-index range", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
    // Nov 2024 .. Feb 2025, spanning the December → January year boundary.
    for (const [y, m, otp] of [
      [2024, 11, 95],
      [2024, 12, 96],
      [2025, 1, 97],
      [2025, 2, 98],
    ] as const) {
      repos.lightRail.upsertOtp({ year: y, month: m, otpPercent: otp });
      repos.lightRail.upsertMdbf({ year: y, month: m, lineName: HBLR, mdbf: 30000 });
    }
  });

  it("includes both endpoints of the OTP range (inclusive)", () => {
    const rows = repos.lightRail.getOtpForRange({ year: 2024, month: 12 }, { year: 2025, month: 1 });
    expect(rows.map((r) => [r.year, r.month])).toEqual([
      [2024, 12],
      [2025, 1],
    ]);
  });

  it("handles the December → January wraparound without pulling adjacent months", () => {
    const dec = repos.lightRail.getOtpForRange({ year: 2024, month: 12 }, { year: 2024, month: 12 });
    expect(dec.map((r) => [r.year, r.month])).toEqual([[2024, 12]]);

    const jan = repos.lightRail.getMdbfForRange({ year: 2025, month: 1 }, { year: 2025, month: 1 });
    expect(jan.map((r) => [r.year, r.month])).toEqual([[2025, 1]]);
  });

  it("applies the same inclusive range to per-line MDBF", () => {
    const mdbf = repos.lightRail.getMdbfForRange({ year: 2024, month: 11 }, { year: 2025, month: 2 });
    expect(mdbf.map((r) => [r.year, r.month])).toEqual([
      [2024, 11],
      [2024, 12],
      [2025, 1],
      [2025, 2],
    ]);
  });
});
