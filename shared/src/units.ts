/**
 * The units every number in the data contract is measured in. Each numeric
 * field in `domain.ts` / `predictions.ts` carries a `@unit <name>` naming an
 * entry here, and the emitter refuses to write a contract where a number has no
 * unit, names one that does not exist, or contradicts its own name.
 *
 * Bounds live here rather than as `minimum`/`maximum` in the record schemas:
 * constraints on a scalar make `datamodel-code-generator` wrap it in a
 * `RootModel`, so `event.delaySeconds` would arrive in Python as an object with
 * a `.root` instead of an int.
 *
 * Self-contained, like the contract modules it describes: no imports.
 */

export interface UnitDescriptor {
  /** Short form, for display. Empty where the unit is dimensionless. */
  symbol: string;
  /**
   * The field-name suffix this unit reserves, or null where it reserves none.
   * The reservation runs one way only — a field named `…Seconds` may declare
   * nothing but `seconds`, but an `epoch_seconds` field need not be named
   * `…EpochSeconds`, since renaming a published field is a v2, not an edit.
   */
  suffix: string | null;
  description: string;
  /** Lower bound every value carries, where the unit itself implies one. */
  minimum?: number;
  /** Upper bound every value carries, where the unit itself implies one. */
  maximum?: number;
}

export const UNITS = {
  seconds: {
    symbol: "s",
    suffix: "Seconds",
    description:
      "A duration in seconds. Signed where the field says so — a delay is positive when late, " +
      "negative when early. Distinct from epoch_seconds: this is an interval, not an instant.",
  },
  epoch_seconds: {
    symbol: "s",
    suffix: "EpochSeconds",
    description:
      "An instant: seconds since the Unix epoch, UTC. Deliberately not the same unit as seconds — " +
      "adding two of these, or reading one as a duration, is the mistake this vocabulary exists to name.",
    minimum: 0,
  },
  epoch_milliseconds: {
    symbol: "ms",
    suffix: "Ms",
    description:
      "An instant: milliseconds since the Unix epoch, UTC. The `Ms` field-name suffix is the " +
      "repo-wide marker for it, and reserving it here makes that convention checkable.",
    minimum: 0,
  },
  percent: {
    symbol: "%",
    suffix: "Percent",
    description: "A share out of 100 — 87.4 means 87.4%, not 8740%. Never a fraction of 1.",
    minimum: 0,
    maximum: 100,
  },
  count: {
    symbol: "",
    suffix: null,
    description:
      "A whole number of things, where the field name says what is counted. No reserved suffix: " +
      "counts are named for the thing (`tripsOperated`, `cancellations`), not for the unit.",
    minimum: 0,
  },
  stop_index: {
    symbol: "",
    suffix: null,
    description:
      "A position within a trip's stop sequence (GTFS `stop_sequence`). An ordinal — not a count " +
      "of stops travelled, and not a distance.",
    minimum: 0,
  },
} as const satisfies Record<string, UnitDescriptor>;

export type UnitName = keyof typeof UNITS;

export const UNIT_NAMES = Object.keys(UNITS) as UnitName[];

export function isUnitName(name: string): name is UnitName {
  return Object.hasOwn(UNITS, name);
}

/**
 * The unit a field name's suffix reserves, or null if it reserves none.
 *
 * Longest suffix wins: `predictedAtEpochSeconds` ends in both `Seconds` and
 * `EpochSeconds` and is an instant, so a plain lookup would not do.
 */
export function reservedUnitFor(fieldName: string): UnitName | null {
  let matched: UnitName | null = null;
  let matchedLength = 0;
  for (const name of UNIT_NAMES) {
    const { suffix } = UNITS[name];
    if (suffix === null || !fieldName.endsWith(suffix)) continue;
    if (suffix.length > matchedLength) {
      matched = name;
      matchedLength = suffix.length;
    }
  }
  return matched;
}
