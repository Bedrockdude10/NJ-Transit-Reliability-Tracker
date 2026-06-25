import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { describe, expect, it } from "vitest";
import {
  buildLineMetrics,
  importNjtPerformanceDir,
  parseCancellationCauses,
  parseCancellationsData,
  parseLightRailMdbf,
  parseLightRailOtp,
  parseMdbf,
  parseOtpData,
} from "../src/official/njt-performance";

// Mirrors NJT's real format: a dashed separator row and space-padded values.
const OTP = `      YEAR,MONTH          ,STATUS ,     COUNT,     TOTAL,PERCENTAGE
----------,---------------,-------,----------,----------,----------
      2024,JUNE           ,Northeast Corridor     ,      2602,      3228,      80.6
      2024,JULY           ,Northeast Corridor     ,      3000,      3300,      90.9
`;

const OTP_ADJUSTED = `      YEAR,MONTH          ,STATUS ,     COUNT,     TOTAL,PERCENTAGE
----------,---------------,-------,----------,----------,----------
      2024,JUNE           ,Northeast Corridor     ,      2800,      3228,      86.7
`;

const CANCELLATIONS = `      YEAR,MONTH          ,CATEGORY        ,CANCEL_COUNT,CANCEL_TOTAL,CANCEL_PERCENTAGE
----------,---------------,----------------,------------,------------,-----------------
      2024,JUNE           ,AMTRAK          ,         128,         196,             65.3
      2024,JUNE           ,Mechanical      ,          52,         196,             26.5
`;

describe("parseOtpData", () => {
  it("skips the dashed separator and reads otp + total", () => {
    const data = parseOtpData(OTP);
    expect([...data.keys()]).toEqual(["2024-6", "2024-7"]);
    expect(data.get("2024-6")).toEqual({ otpPercent: 80.6, tripsOperated: 3228 });
  });
});

describe("parseCancellationsData", () => {
  it("reads the month's total cancellations once", () => {
    expect(parseCancellationsData(CANCELLATIONS).get("2024-6")).toBe(196);
  });
});

describe("parseCancellationCauses", () => {
  it("breaks cancellations down by cause", () => {
    expect(parseCancellationCauses(CANCELLATIONS).get("2024-6")).toEqual({ AMTRAK: 128, Mechanical: 52 });
  });
});

const MDBF = `MONTH          ,      MDBF
---------------,----------
2024 June      ,     90000
2024 July      ,     85000
`;

describe("parseMdbf", () => {
  it("parses the 'YYYY MonthName' format", () => {
    expect(parseMdbf(MDBF)).toEqual([
      { year: 2024, month: 6, mdbf: 90000 },
      { year: 2024, month: 7, mdbf: 85000 },
    ]);
  });
});

const LR_OTP = `MONTH          ,       OTP
---------------,----------
2024 June      ,        97
2024 July      ,        96
`;

const LR_MDBF = `MONTH          ,LINE                            ,      MDBF
---------------,--------------------------------,----------
2024 June      ,Hudson-Bergen Light Rail        ,     30000
2024 June      ,Newark Light Rail               ,     20000
`;

describe("light rail parsers", () => {
  it("parses systemwide light rail OTP", () => {
    expect(parseLightRailOtp(LR_OTP)).toEqual([
      { year: 2024, month: 6, otpPercent: 97 },
      { year: 2024, month: 7, otpPercent: 96 },
    ]);
  });

  it("parses per-line light rail MDBF", () => {
    expect(parseLightRailMdbf(LR_MDBF)).toEqual([
      { year: 2024, month: 6, lineName: "Hudson-Bergen Light Rail", mdbf: 30000 },
      { year: 2024, month: 6, lineName: "Newark Light Rail", mdbf: 20000 },
    ]);
  });
});

describe("buildLineMetrics", () => {
  it("joins OTP, Amtrak-adjusted OTP, and cancellations", () => {
    const metrics = buildLineMetrics("Northeast Corridor Line", OTP, OTP_ADJUSTED, CANCELLATIONS);
    const june = metrics.find((m) => m.month === 6);
    const july = metrics.find((m) => m.month === 7);
    expect(june).toEqual({
      year: 2024,
      month: 6,
      lineName: "Northeast Corridor Line",
      otpPercent: 80.6,
      otpPercentAmtrakAdjusted: 86.7,
      tripsOperated: 3228,
      cancellations: 196,
      cancellationCauses: { AMTRAK: 128, Mechanical: 52 },
    });
    // July has no adjusted/cancellation rows → null / 0, not a partial record.
    expect(july?.otpPercentAmtrakAdjusted).toBeNull();
    expect(july?.cancellations).toBe(0);
  });
});

describe("importNjtPerformanceDir", () => {
  it("imports per-line files by filename code and maps to catalog names", () => {
    const dir = mkdtempSync(join(tmpdir(), "njt-perf-"));
    writeFileSync(join(dir, "RAIL_NEC_OTP_DATA.csv"), OTP);
    writeFileSync(join(dir, "RAIL_NEC_OTP_DATA_AMTRAK_ADJUSTED.csv"), OTP_ADJUSTED);
    writeFileSync(join(dir, "RAIL_NEC_CANCELLATIONS_DATA.csv"), CANCELLATIONS);
    writeFileSync(join(dir, "RAIL_MDBF_DATA.csv"), MDBF);
    writeFileSync(join(dir, "LIGHTRAIL_OTP_DATA.csv"), LR_OTP);
    writeFileSync(join(dir, "LIGHTRAIL_MDBF_DATA.csv"), LR_MDBF);

    const repos: Repositories = createRepositories(openDatabase());
    const result = importNjtPerformanceDir(repos, dir);

    expect(result.lines).toEqual([{ lineName: "Northeast Corridor Line", metrics: 2 }]);
    expect(result.totalMetrics).toBe(2);
    expect(result.mdbfMonths).toBe(2);
    expect(result.lightRailOtpMonths).toBe(2);
    expect(result.lightRailMdbfRows).toBe(2);
    expect(repos.lightRail.getOtpForRange({ year: 2024, month: 1 }, { year: 2024, month: 12 })).toHaveLength(2);
    const stored = repos.official.getAllForLine("Northeast Corridor Line");
    expect(stored).toHaveLength(2);
    expect(stored.find((m) => m.month === 6)?.otpPercentAmtrakAdjusted).toBe(86.7);
    expect(stored.find((m) => m.month === 6)?.cancellationCauses).toEqual({ AMTRAK: 128, Mechanical: 52 });
    expect(repos.official.getMdbfForRange({ year: 2024, month: 1 }, { year: 2024, month: 12 })).toHaveLength(2);
  });
});
