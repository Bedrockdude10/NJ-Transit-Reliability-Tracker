import { describe, expect, it } from "vitest";
import { DARK } from "../palette";
import { otpColor, otpColorAt, otpColorSoft } from "../theme";

describe("otpColor", () => {
  it("picks good/warn/bad CSS vars across the >=90 and >=75 boundaries", () => {
    expect(otpColor(95)).toBe("var(--njt-good)");
    expect(otpColor(90)).toBe("var(--njt-good)");
    expect(otpColor(89.9)).toBe("var(--njt-warn)");
    expect(otpColor(75)).toBe("var(--njt-warn)");
    expect(otpColor(74.9)).toBe("var(--njt-bad)");
  });
});

describe("otpColorSoft", () => {
  it("picks the soft tints across the same boundaries", () => {
    expect(otpColorSoft(95)).toBe("var(--njt-goodSoft)");
    expect(otpColorSoft(90)).toBe("var(--njt-goodSoft)");
    expect(otpColorSoft(89.9)).toBe("var(--njt-warnSoft)");
    expect(otpColorSoft(75)).toBe("var(--njt-warnSoft)");
    expect(otpColorSoft(74.9)).toBe("var(--njt-badSoft)");
  });
});

describe("otpColorAt", () => {
  it("resolves concrete palette colors across the same boundaries", () => {
    expect(otpColorAt(DARK, 95)).toBe(DARK.good);
    expect(otpColorAt(DARK, 90)).toBe(DARK.good);
    expect(otpColorAt(DARK, 89.9)).toBe(DARK.warn);
    expect(otpColorAt(DARK, 75)).toBe(DARK.warn);
    expect(otpColorAt(DARK, 74.9)).toBe(DARK.bad);
  });
});
