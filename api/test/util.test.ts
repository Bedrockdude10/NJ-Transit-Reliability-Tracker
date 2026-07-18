import { describe, expect, it } from "vitest";
import { ApiError, badRequest, notFound, parseHeatmapType, parseLimit, parsePositiveInt, round1, slugify } from "../src/util";

describe("ApiError + throwers", () => {
  it("badRequest throws a 400 ApiError", () => {
    expect(() => badRequest("nope")).toThrowError(ApiError);
    try {
      badRequest("bad thing");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).message).toBe("bad thing");
      expect((e as ApiError).name).toBe("ApiError");
    }
  });

  it("notFound throws a 404 ApiError", () => {
    try {
      notFound("missing");
    } catch (e) {
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).message).toBe("missing");
    }
  });
});

describe("slugify", () => {
  it("lowercases, replaces & with 'and', and collapses non-alphanumerics", () => {
    expect(slugify("Main/Bergen County Line")).toBe("main-bergen-county-line");
    expect(slugify("Pascack Valley & Spur")).toBe("pascack-valley-and-spur");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Foo!!  ")).toBe("foo");
    expect(slugify("***")).toBe("");
  });
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.36)).toBe(12.4);
    expect(round1(10)).toBe(10);
  });
});

describe("parseLimit", () => {
  it("uses the fallback when absent, invalid, or below 1", () => {
    expect(parseLimit(undefined, 25)).toBe(25);
    expect(parseLimit("abc", 25)).toBe(25);
    expect(parseLimit("0", 25)).toBe(25);
    expect(parseLimit("-5", 25)).toBe(25);
  });

  it("floors and clamps to 100", () => {
    expect(parseLimit("7.9", 25)).toBe(7);
    expect(parseLimit("500", 25)).toBe(100);
    expect(parseLimit("50", 25)).toBe(50);
  });
});

describe("parsePositiveInt", () => {
  it("uses the fallback when absent, invalid, or below 1", () => {
    expect(parsePositiveInt(undefined, 1)).toBe(1);
    expect(parsePositiveInt("abc", 50)).toBe(50);
    expect(parsePositiveInt("0", 1)).toBe(1);
    expect(parsePositiveInt("-3", 1)).toBe(1);
  });

  it("floors fractional values (no fractional OFFSET/page)", () => {
    expect(parsePositiveInt("1.5", 1)).toBe(1);
    expect(parsePositiveInt("2.9", 1)).toBe(2);
  });

  it("clamps to the optional max", () => {
    expect(parsePositiveInt("500", 50, 200)).toBe(200);
    expect(parsePositiveInt("500", 50)).toBe(500); // no max by default
  });
});

describe("parseHeatmapType", () => {
  it("defaults to hour_of_day and accepts valid types", () => {
    expect(parseHeatmapType(undefined)).toBe("hour_of_day");
    expect(parseHeatmapType("day_of_week")).toBe("day_of_week");
  });

  it("rejects an unknown type with a 400", () => {
    try {
      parseHeatmapType("year_of_life");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(400);
    }
  });
});
