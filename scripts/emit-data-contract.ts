/**
 * Emit the object-storage data contract as JSON Schema, for `njt-delay-modeling`
 * to generate pydantic models from. A breaking change is a new `contract/vN/`
 * directory, never an edit to an existing one.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { CONTRACT_VERSION, DATASETS } from "../shared/src/datasets";
import { tripStopEventSchema } from "../shared/src/domain.zod";
import { delayPredictionSchema, modelScorecardSchema } from "../shared/src/predictions.zod";
import { UNITS } from "../shared/src/units";
import { checkUnits, contractFieldsOf } from "./contract-units";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = CONTRACT_VERSION;
const OUT_DIR = resolve(ROOT, "contract", VERSION);

/** `id` doubles as the emitted filename and as the schema's `$id`. */
const CONTRACT = [
  {
    id: "trip-stop-event",
    prefix: "events/",
    schema: tripStopEventSchema,
    source: "shared/src/domain.ts",
    typeName: "TripStopEvent",
    description: "One observed reading per (trip, stop, service date). Written by the ingest pipeline.",
  },
  {
    id: "delay-prediction",
    prefix: "predictions/",
    schema: delayPredictionSchema,
    source: "shared/src/predictions.ts",
    typeName: "DelayPrediction",
    description: "A predicted terminal delay. Written by njt-delay-modeling, read by the API.",
  },
  {
    id: "model-scorecard",
    prefix: "scorecards/",
    schema: modelScorecardSchema,
    source: "shared/src/predictions.ts",
    typeName: "ModelScorecard",
    description: "Per-model, per-day accuracy summary. Written by njt-delay-modeling.",
  },
] as const;

/**
 * The range `z.int()` records as minimum/maximum, stripped below: any scalar
 * constraint makes `datamodel-code-generator` wrap the field in a `RootModel`,
 * so `delaySeconds` would arrive in Python as an object with a `.root`.
 */
/**
 * `anyOf: [T, {}]` back to plain `T`. ts-to-zod renders an optional
 * `number | undefined` as a union *containing* `z.undefined()`, which zod will only
 * represent as an empty schema — so the emitted contract would otherwise depend on
 * how the generator spells optionality.
 */
function collapseOptionalUnion(node: Record<string, unknown>): void {
  const branches = node.anyOf;
  if (!Array.isArray(branches) || branches.length !== 2) return;
  const real = branches.filter((branch) => Object.keys(branch as object).length > 0);
  if (real.length !== 1) return;
  delete node.anyOf;
  Object.assign(node, real[0]);
}

const JS_SAFE_INTEGER = 9_007_199_254_740_991;

const units = new Map<string, Map<string, string>>();
const unitProblems: string[] = [];

for (const entry of CONTRACT) {
  const fields = contractFieldsOf(resolve(ROOT, entry.source), entry.typeName);
  for (const problem of checkUnits(fields)) {
    unitProblems.push(`${entry.source} ${entry.typeName}.${problem.field} ${problem.problem}`);
  }
  units.set(
    entry.id,
    new Map(
      fields
        .filter((field): field is typeof field & { unit: string } => field.unit !== null)
        .map((field) => [field.name, field.unit]),
    ),
  );
}

if (unitProblems.length > 0) {
  console.error("Refusing to emit a contract with undeclared or contradicted units:\n");
  for (const problem of unitProblems) console.error(`  • ${problem}`);
  console.error("\nSee shared/src/units.ts for the vocabulary.");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const entry of CONTRACT) {
  const jsonSchema = z.toJSONSchema(entry.schema, {
    target: "draft-7",
    unrepresentable: "any",
    override: ({ jsonSchema: node }) => {
      collapseOptionalUnion(node);
      if (node.type !== "integer") return;
      if (node.minimum === -JS_SAFE_INTEGER) delete node.minimum;
      if (node.maximum === JS_SAFE_INTEGER) delete node.maximum;
    },
  });
  // The unit rides on the property itself; each unit's bounds travel in
  // `units.json`, never as `minimum`/`maximum` here (see JS_SAFE_INTEGER).
  const declared = units.get(entry.id) ?? new Map<string, string>();
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  for (const [field, unit] of declared) {
    const property = properties?.[field];
    if (!property) {
      throw new Error(
        `${entry.typeName}.${field} declares @unit ${unit} but is absent from the generated schema — run 'npm run generate:contract'`,
      );
    }
    property.unit = unit;
  }

  const document = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://njt-reliability-tracker/contract/${VERSION}/${entry.id}.schema.json`,
    title: entry.id
      .split("-")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(""),
    description: `${entry.description} Object-storage prefix: ${entry.prefix}`,
    ...jsonSchema,
  };
  const path = resolve(OUT_DIR, `${entry.id}.schema.json`);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote contract/${VERSION}/${entry.id}.schema.json`);
}

const datasetsPath = resolve(OUT_DIR, "datasets.json");
writeFileSync(
  datasetsPath,
  `${JSON.stringify({ version: VERSION, datasets: DATASETS }, null, 2)}\n`,
);
console.log(`Wrote contract/${VERSION}/datasets.json`);

/** The vocabulary the `unit` keywords above refer to, plus each unit's bounds. */
writeFileSync(
  resolve(OUT_DIR, "units.json"),
  `${JSON.stringify({ version: VERSION, units: UNITS }, null, 2)}\n`,
);
console.log(`Wrote contract/${VERSION}/units.json`);

const MANIFEST = "manifest.json";

/**
 * Every contract file except the manifest itself: a leftover manifest from the
 * previous run would make each digest depend on the last one and change on every
 * emit — and `git diff` in CI cannot see that, since it is untracked at first.
 */
const files = readdirSync(OUT_DIR)
  .filter((name) => name.endsWith(".json") && name !== MANIFEST)
  .sort();
const digests = Object.fromEntries(
  files.map((name) => [
    name,
    createHash("sha256").update(readFileSync(resolve(OUT_DIR, name))).digest("hex"),
  ]),
);
const contractDigest = createHash("sha256")
  .update(files.map((name) => `${name}:${digests[name]}`).join("\n"))
  .digest("hex");

writeFileSync(
  resolve(OUT_DIR, MANIFEST),
  `${JSON.stringify({ version: VERSION, digest: contractDigest, files: digests }, null, 2)}\n`,
);
console.log(`Wrote contract/${VERSION}/manifest.json (${contractDigest.slice(0, 12)}…)`);
