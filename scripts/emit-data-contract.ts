/**
 * Emit the object-storage data contract as JSON Schema.
 *
 * This is the seam between this repo and `njt-delay-modeling`. TypeScript is the
 * schema authority — the API has to be able to read every artifact in the
 * system, and one generation direction is far easier to keep honest than two —
 * so these files are generated here and consumed there, where
 * `datamodel-code-generator` turns them into pydantic models.
 *
 * The chain is off-the-shelf at every hop: interfaces → Zod (ts-to-zod) → JSON
 * Schema (`z.toJSONSchema`, native in Zod 4) → pydantic. Nothing is written
 * twice, so the two repos cannot drift into disagreeing about a field.
 *
 * Schemas are versioned by directory (`v1/`). A breaking change means a new
 * directory, not an edit — readers of already-written Parquet must keep working.
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

/**
 * What crosses the boundary, and under which prefix in object storage.
 *
 * `id` doubles as the filename and as the `$id` in the schema, so a generated
 * pydantic model can be traced back to the artifact it describes.
 */
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
 * JavaScript's safe-integer range, which `z.int()` records as minimum/maximum.
 *
 * A language artifact, not a domain rule — every integer a JS producer can emit
 * is inside it by definition — and it does real harm downstream: constraints on a
 * scalar make `datamodel-code-generator` wrap it in a `RootModel`, so
 * `event.delaySeconds` arrives in Python as an object with a `.root` instead of an
 * int, which would infect every feature expression in the modelling repo.
 *
 * Dropped through Zod's own `override` hook. This was a recursive walk over the
 * emitted document deleting any minimum/maximum that happened to equal ±2^53 —
 * which worked, but pattern-matched on a magic number after the fact and would
 * have quietly eaten a real bound that happened to share the value.
 */
const JS_SAFE_INTEGER = 9_007_199_254_740_991;

/**
 * The units, read back off the interfaces the schemas were generated from.
 *
 * Refusing to emit is the point. `horizonSeconds` once carried a count of
 * stops, and it passed the generated pydantic models and pandera alike, because
 * the only statement of the unit was the field's own name — which nothing
 * validates. A number whose unit is undeclared, unknown, or contradicted by its
 * name now stops the build here, before it can reach a bucket and a model.
 */
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
    override: ({ jsonSchema: node }) => {
      if (node.type !== "integer") return;
      if (node.minimum === -JS_SAFE_INTEGER) delete node.minimum;
      if (node.maximum === JS_SAFE_INTEGER) delete node.maximum;
    },
  });
  // The unit rides on the property itself, beside `type` or `anyOf`. Not as
  // `minimum`/`maximum`: constraints on a scalar make datamodel-code-generator
  // wrap it in a RootModel, which is why the safe-integer bounds are stripped
  // above. Each unit's bounds travel in `units.json` instead, where the
  // consumer reads them to build its own checks and the record schemas stay
  // plain enough to generate clean pydantic types.
  const declared = units.get(entry.id) ?? new Map<string, string>();
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  for (const [field, unit] of declared) {
    const property = properties?.[field];
    // A field with a unit but no property means the interface and its generated
    // Zod schema have diverged — regenerate rather than emit a half-annotated
    // contract.
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

/**
 * The bucket layout, emitted alongside the record schemas.
 *
 * Both repos build their object keys from this rather than from a copy of the
 * rule. A prefix or suffix written out twice is the drift that fails silently:
 * the reader finds no objects and reports success.
 */
const datasetsPath = resolve(OUT_DIR, "datasets.json");
writeFileSync(
  datasetsPath,
  `${JSON.stringify({ version: VERSION, datasets: DATASETS }, null, 2)}\n`,
);
console.log(`Wrote contract/${VERSION}/datasets.json`);

/**
 * The unit vocabulary the `unit` keywords above refer to.
 *
 * Emitted rather than restated on the Python side, for the same reason the
 * dataset layout is: a vocabulary written out twice drifts, and a consumer
 * checking against its own stale copy of "what percent means" reports success.
 * The bounds live here so the record schemas stay free of scalar constraints.
 */
writeFileSync(
  resolve(OUT_DIR, "units.json"),
  `${JSON.stringify({ version: VERSION, units: UNITS }, null, 2)}\n`,
);
console.log(`Wrote contract/${VERSION}/units.json`);

/** The manifest describes the contract; it cannot describe itself. */
const MANIFEST = "manifest.json";

/**
 * A digest of the whole contract, for detecting drift between *deployments*.
 *
 * The repositories already fail CI when the generated models are stale, but that
 * only compares two checkouts. It cannot see the case that actually bites: a
 * producer deployed weeks ago writing an older contract than the consumer was
 * generated from. The producer publishes this manifest into the bucket and the
 * consumer checks it before reading, so that disagreement surfaces as a sentence
 * naming both digests rather than as rows quietly failing validation.
 *
 * Content-addressed rather than a version number someone has to remember to
 * bump, and stable: sorted by filename, hashing bytes.
 */
/**
 * Every contract file except the manifest itself.
 *
 * Excluding it is not tidiness: a manifest left over from the previous run is a
 * file in this directory, so hashing the directory wholesale made each digest
 * depend on the last one and change on every emit. That went unnoticed because
 * the CI check compared with `git diff`, which says nothing about files git is
 * not yet tracking.
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
