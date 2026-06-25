import { describe, expect, it } from "vitest";
import { parseOfficialMetrics } from "../src/official/parse";

describe("parseOfficialMetrics", () => {
  it("maps aliased headers and strips % from numbers", () => {
    const csv =
      "Year,Month,Line,OTP_Percent,OTP_Amtrak_Adjusted,Trips_Operated,Cancellations\n" +
      "2025,7,Northeast Corridor Line,88.5%,91.2%,3000,50\n";
    const metrics = parseOfficialMetrics(csv);
    expect(metrics).toEqual([
      {
        year: 2025,
        month: 7,
        lineName: "Northeast Corridor Line",
        otpPercent: 88.5,
        otpPercentAmtrakAdjusted: 91.2,
        tripsOperated: 3000,
        cancellations: 50,
        cancellationCauses: null,
      },
    ]);
  });

  it("skips rows missing required fields and tolerates a missing adjusted column", () => {
    const csv = "year,month,line,otp\n2025,7,Raritan Valley Line,82\n,,,\n";
    const metrics = parseOfficialMetrics(csv);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.otpPercentAmtrakAdjusted).toBeNull();
  });
});
