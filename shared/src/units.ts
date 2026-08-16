/**
 * The units every number in the data contract is measured in.
 *
 * TypeScript has one numeric type, so `horizonSeconds: number` says nothing
 * about what the number counts. The unit lived only in the field name, which is
 * a comment that the compiler, the generated pydantic models and pandera all
 * ignore — and a value in stops was published under `horizonSeconds` and passed
 * every check on both sides of the seam.
 *
 * So the unit becomes part of the contract. Each numeric field in
 * `domain.ts` / `predictions.ts` carries a `@unit <name>` tag naming an entry
 * here; the emitter refuses to write a contract where a number has no unit, or
 * names one that does not exist, or is named `…Seconds` while declaring
 * something else. The unit then travels into the emitted JSON Schema as a
 * `unit` keyword, and this table travels beside it as `units.json`, so the
 * Python side enforces the same vocabulary rather than a copy of it.
 *
 * Bounds live here rather than as `minimum`/`maximum` in the record schemas on
 * purpose. Constraints on a scalar make `datamodel-code-generator` wrap it in a
 * `RootModel`, so `event.delaySeconds` would arrive in Python as an object with
 * a `.root` instead of an int — the same reason the emitter strips Zod's
 * safe-integer bounds. A vocabulary the consumer reads to build its own checks
 * costs the record schemas nothing.
 *
 * Self-contained, like the contract modules it describes: no imports.
 */

export interface UnitDescriptor {
  /** Short form, for display. Empty where the unit is dimensionless. */
  symbol: string;
  /**
   * The field-name suffix this unit reserves, or null where it reserves none.
   *
   * A reservation runs one way: a field *named* `…Seconds` may declare nothing
   * but `seconds`. Changing what such a field measures therefore has to rename
   * it, which a reviewer and a downstream consumer both see — where editing a
   * doc comment is invisible to everything.
   *
   * Not the other way. `scheduledArrival` is an instant and always has been;
   * requiring every `epoch_seconds` field to be named `…EpochSeconds` would
   * mean renaming fields in a published contract, which is a v2, not an edit.
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
 * Longest suffix wins, which is the whole reason the resolution is a function
 * rather than a lookup: `predictedAtEpochSeconds` ends in both `Seconds` and
 * `EpochSeconds`, and it is an instant. Matching the shorter one would force
 * every epoch field to claim it holds a duration.
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
