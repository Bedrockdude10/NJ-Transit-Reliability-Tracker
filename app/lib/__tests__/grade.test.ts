import { describe, expect, it } from "vitest";
import { reliabilityGrade } from "../grade";

describe("reliabilityGrade", () => {
  it("maps OTP percentages to demanding letter bands", () => {
    expect(reliabilityGrade(97).grade).toBe("A");
    expect(reliabilityGrade(95).grade).toBe("A");
    expect(reliabilityGrade(94.9).grade).toBe("B");
    expect(reliabilityGrade(90).grade).toBe("B");
    expect(reliabilityGrade(87).grade).toBe("C");
    expect(reliabilityGrade(82).grade).toBe("D");
    expect(reliabilityGrade(79).grade).toBe("F");
    expect(reliabilityGrade(0).grade).toBe("F");
  });

  it("carries a color and tint for display", () => {
    const a = reliabilityGrade(96);
    expect(a.color).toBeTruthy();
    expect(a.tint).toBeTruthy();
  });
});
