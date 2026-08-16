import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkUnits, contractFieldsOf, readContractFields } from "../contract-units";

const ROOT = resolve(import.meta.dirname, "../..");

const SAMPLE = `
export interface Sample {
  name: string;
  /** @unit seconds */
  horizonSeconds: number;
  /**
   * When it was made.
   * @format int
   * @unit epoch_seconds
   */
  predictedAtEpochSeconds: number;
  /** Null until known. @unit seconds */
  actualDelaySeconds: number | null;
  /** Present only on days the model produced one. @unit seconds */
  optionalSeconds?: number;
  /** @unit count */
  legs: number;
  flagged: boolean;
}
`;

describe("readContractFields", () => {
  const fields = readContractFields(SAMPLE, "Sample");
  const byName = new Map(fields.map((f) => [f.name, f]));

  it("reads every property in declaration order", () => {
    expect(fields.map((f) => f.name)).toEqual([
      "name",
      "horizonSeconds",
      "predictedAtEpochSeconds",
      "actualDelaySeconds",
      "optionalSeconds",
      "legs",
      "flagged",
    ]);
  });

  it("picks the @unit tag out of a multi-tag doc comment", () => {
    expect(byName.get("predictedAtEpochSeconds")).toMatchObject({
      numeric: true,
      unit: "epoch_seconds",
    });
  });

  it("treats a nullable number as numeric", () => {
    expect(byName.get("actualDelaySeconds")).toMatchObject({ numeric: true, unit: "seconds" });
  });

  it("treats an optional number as numeric", () => {
    expect(byName.get("optionalSeconds")).toMatchObject({ numeric: true, unit: "seconds" });
  });

  it("does not mistake strings or booleans for numbers", () => {
    expect(byName.get("name")?.numeric).toBe(false);
    expect(byName.get("flagged")?.numeric).toBe(false);
  });

  it("fails loudly when the interface is not there, rather than reporting no fields", () => {
    expect(() => readContractFields(SAMPLE, "Missing")).toThrow(/Missing/);
  });
});

/**
 * One property, laid out the way a real contract file is.
 *
 * The line breaks are load-bearing: TypeScript does not attach a doc comment
 * that shares a line with preceding code, so a one-line fixture would read as
 * having no `@unit` tag and quietly pass tests that assert a tag is missing.
 */
function withOneField(doc: string | null, declaration: string): string {
  return `export interface S {\n${doc === null ? "" : `  /** ${doc} */\n`}  ${declaration}\n}`;
}

describe("checkUnits", () => {
  const problems = (source: string) =>
    checkUnits(readContractFields(source, "S")).map((p) => p.problem);

  it("passes an interface where every number declares a known, agreeing unit", () => {
    expect(checkUnits(readContractFields(SAMPLE, "Sample"))).toEqual([]);
  });

  it("rejects a number with no unit at all", () => {
    expect(problems(withOneField(null, "legs: number;"))[0]).toMatch(/no @unit/);
  });

  it("does not let an optional field skip its unit", () => {
    expect(problems(withOneField(null, "spareSeconds?: number;"))[0]).toMatch(/no @unit/);
  });

  it("rejects a unit that is not in the vocabulary", () => {
    expect(problems(withOneField("@unit stops", "stopsAhead: number;"))[0]).toMatch(
      /unknown unit `stops`/,
    );
  });

  /**
   * The production bug, in miniature: a count of stops published under a name
   * that says seconds. Both sides validated it, because the unit was only in
   * the name. Here the name reserves `seconds` and the declaration disagrees.
   */
  it("rejects a `…Seconds` field that declares it holds something else", () => {
    expect(problems(withOneField("@unit stop_index", "horizonSeconds: number;"))[0]).toMatch(
      /name and the unit must agree/,
    );
  });

  it("rejects an epoch field that claims to be a duration", () => {
    expect(problems(withOneField("@unit seconds", "predictedAtEpochSeconds: number;"))[0]).toMatch(
      /name and the unit must agree/,
    );
  });

  it("rejects a unit tag on something that is not a number", () => {
    expect(problems(withOneField("@unit seconds", "lineName: string;"))[0]).toMatch(/not a number/);
  });

  it("leaves names that reserve no suffix free to declare any unit", () => {
    expect(problems(withOneField("@unit stop_index", "stopSequence: number;"))).toEqual([]);
  });

  it("names the field it is complaining about", () => {
    expect(checkUnits(readContractFields(withOneField(null, "legs: number;"), "S"))[0]).toMatchObject({
      field: "legs",
    });
  });
});

/**
 * The guard that actually holds the line. Everything above proves the checker
 * works; this proves it is pointed at the real contract, so a number added to
 * `domain.ts` or `predictions.ts` without a unit fails here and in CI.
 */
describe("the real contract", () => {
  it.each([
    ["shared/src/domain.ts", "TripStopEvent"],
    ["shared/src/predictions.ts", "DelayPrediction"],
    ["shared/src/predictions.ts", "ModelScorecard"],
  ])("%s %s declares a unit for every number", (file, typeName) => {
    expect(checkUnits(contractFieldsOf(resolve(ROOT, file), typeName))).toEqual([]);
  });
});
