import { describe, expect, it } from "vitest";
import { UNITS, UNIT_NAMES, type UnitDescriptor, isUnitName, reservedUnitFor } from "../src/units";

/**
 * `as const satisfies` narrows each entry to its own literal shape, so the
 * optional bounds are absent from the union's type. Reading through the
 * interface is what the emitter and the Python side both do.
 */
const descriptorOf = (name: (typeof UNIT_NAMES)[number]): UnitDescriptor => UNITS[name];

describe("unit vocabulary", () => {
  it("reserves each suffix for exactly one unit", () => {
    const suffixes = UNIT_NAMES.map((name) => UNITS[name].suffix).filter((s) => s !== null);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it("keeps bounds consistent where a unit declares them", () => {
    const bounded = UNIT_NAMES.map((name) => {
      const { minimum, maximum } = descriptorOf(name);
      return { minimum, maximum };
    }).filter(
      (d): d is { minimum: number; maximum: number } =>
        d.minimum !== undefined && d.maximum !== undefined,
    );
    for (const { minimum, maximum } of bounded) expect(minimum).toBeLessThan(maximum);
  });

  it("bounds percent to a share out of 100, since that is the confusable one", () => {
    expect(descriptorOf("percent")).toMatchObject({ minimum: 0, maximum: 100 });
  });

  it("recognises its own names and nothing else", () => {
    expect(isUnitName("seconds")).toBe(true);
    expect(isUnitName("stops")).toBe(false);
    // Inherited object properties are not units.
    expect(isUnitName("toString")).toBe(false);
  });
});

describe("reservedUnitFor", () => {
  it("binds a `…Seconds` name to the duration unit", () => {
    expect(reservedUnitFor("horizonSeconds")).toBe("seconds");
    expect(reservedUnitFor("predictedDelaySeconds")).toBe("seconds");
  });

  it("prefers the longer suffix, so an epoch field is an instant not a duration", () => {
    expect(reservedUnitFor("predictedAtEpochSeconds")).toBe("epoch_seconds");
  });

  it("binds the `Ms` convention to epoch milliseconds", () => {
    expect(reservedUnitFor("ingestedAtMs")).toBe("epoch_milliseconds");
  });

  it("binds `…Percent`", () => {
    expect(reservedUnitFor("falselyReassuringPercent")).toBe("percent");
  });

  it("reserves nothing for names that carry no unit suffix", () => {
    expect(reservedUnitFor("stopSequence")).toBeNull();
    expect(reservedUnitFor("tripsOperated")).toBeNull();
    expect(reservedUnitFor("lineName")).toBeNull();
  });
});
