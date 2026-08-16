/**
 * Read the `@unit` tags off the contract's interfaces, and refuse the ones that
 * do not add up.
 *
 * The unit of a number is contract, not commentary: `njt-delay-modeling`
 * generates pydantic models from what this emits, and a published value whose
 * unit lives only in its field name is a value nothing can check. See
 * `shared/src/units.ts` for the vocabulary and why bounds are not emitted as
 * JSON Schema constraints.
 *
 * Read syntactically — `ts.createSourceFile`, no type checker and no program.
 * `domain.ts` and `predictions.ts` are self-contained by design (that is why
 * ts-to-zod can read them), so every field's type is spelled out in the file,
 * and a full type-check here would be slower and no more correct.
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { UNITS, UNIT_NAMES, isUnitName, reservedUnitFor } from "../shared/src/units";

export interface ContractField {
  name: string;
  /** Whether the declared type is `number`, alone or unioned with null/undefined. */
  numeric: boolean;
  /** The `@unit` tag's value verbatim, or null when the field carries none. */
  unit: string | null;
}

export interface UnitProblem {
  field: string;
  problem: string;
}

/** Whether a type annotation is a number, allowing `| null` and `| undefined`. */
function isNumeric(type: ts.TypeNode | undefined): boolean {
  if (!type) return false;
  if (type.kind === ts.SyntaxKind.NumberKeyword) return true;
  if (!ts.isUnionTypeNode(type)) return false;

  const substantive = type.types.filter((member) => {
    if (member.kind === ts.SyntaxKind.UndefinedKeyword) return false;
    // `null` in a union parses as a literal type, not a keyword type.
    if (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword) {
      return false;
    }
    return true;
  });
  return substantive.length > 0 && substantive.every((m) => m.kind === ts.SyntaxKind.NumberKeyword);
}

function unitTag(property: ts.PropertySignature): string | null {
  for (const tag of ts.getJSDocTags(property)) {
    if (tag.tagName.text !== "unit") continue;
    const comment = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    return (comment ?? "").trim();
  }
  return null;
}

/** Every property of one interface in a TypeScript source, in declaration order. */
export function readContractFields(source: string, interfaceName: string): ContractField[] {
  // `setParentNodes` is required: `getJSDocTags` walks upward to find the
  // comment attached to a node, and returns nothing without parent pointers.
  const file = ts.createSourceFile(`${interfaceName}.contract.ts`, source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (!declaration) throw new Error(`no interface named ${interfaceName} in the given source`);

  return declaration.members.filter(ts.isPropertySignature).map((property) => ({
    name: property.name.getText(file),
    numeric: isNumeric(property.type),
    unit: unitTag(property),
  }));
}

/** The same, from a file on disk. */
export function contractFieldsOf(path: string, interfaceName: string): ContractField[] {
  return readContractFields(readFileSync(path, "utf8"), interfaceName);
}

/**
 * Everything wrong with an interface's units, or an empty list.
 *
 * One problem per field: the first thing wrong with a field is the thing to
 * fix, and reporting that a unit is both unknown and disagreeing with the name
 * is noise.
 */
export function checkUnits(fields: readonly ContractField[]): UnitProblem[] {
  const problems: UnitProblem[] = [];
  const vocabulary = UNIT_NAMES.join(", ");

  for (const field of fields) {
    const reserved = reservedUnitFor(field.name);

    if (!field.numeric) {
      if (field.unit !== null) {
        problems.push({
          field: field.name,
          problem: `declares @unit ${field.unit} but is not a number`,
        });
      }
      continue;
    }

    if (field.unit === null) {
      const hint = reserved === null ? "" : ` — its name reserves \`${reserved}\``;
      problems.push({
        field: field.name,
        problem: `is a number with no @unit tag${hint}. Every number in the contract must declare one of: ${vocabulary}`,
      });
      continue;
    }

    if (!isUnitName(field.unit)) {
      problems.push({
        field: field.name,
        problem: `declares unknown unit \`${field.unit}\`. Add it to shared/src/units.ts, or use one of: ${vocabulary}`,
      });
      continue;
    }

    if (reserved !== null && reserved !== field.unit) {
      problems.push({
        field: field.name,
        problem:
          `is named \`…${UNITS[reserved].suffix}\`, which reserves \`${reserved}\`, but declares ` +
          `@unit ${field.unit}. The name and the unit must agree — rename the field, or fix the unit.`,
      });
    }
  }

  return problems;
}
