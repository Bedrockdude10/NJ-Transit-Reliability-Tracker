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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { tripStopEventSchema } from "../shared/src/domain.zod";
import { delayPredictionSchema, modelScorecardSchema } from "../shared/src/predictions.zod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "v1";
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
    description: "One observed reading per (trip, stop, service date). Written by the ingest pipeline.",
  },
  {
    id: "delay-prediction",
    prefix: "predictions/",
    schema: delayPredictionSchema,
    description: "A predicted terminal delay. Written by njt-delay-modeling, read by the API.",
  },
  {
    id: "model-scorecard",
    prefix: "scorecards/",
    schema: modelScorecardSchema,
    description: "Per-model, per-day accuracy summary. Written by njt-delay-modeling.",
  },
] as const;

/**
 * JavaScript's safe-integer range, which `z.int()` records as minimum/maximum.
 *
 * A language artifact, not a domain rule — every integer a JS producer can emit
 * is inside it by definition — and it does real harm downstream: constraints on
 * a scalar make `datamodel-code-generator` wrap it in a `RootModel`, so
 * `event.delaySeconds` becomes an object with a `.root` instead of an int, which
 * would infect every feature expression in the modelling repo.
 */
const JS_SAFE_INTEGER = 9_007_199_254_740_991;

/** Strip the safe-integer bounds wherever they appear, however deeply nested. */
function withoutSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutSafeIntegerBounds);
  if (node === null || typeof node !== "object") return node;

  const entries = Object.entries(node as Record<string, unknown>).filter(([key, value]) => {
    const isBound = key === "minimum" || key === "maximum";
    return !(isBound && Math.abs(value as number) === JS_SAFE_INTEGER);
  });
  return Object.fromEntries(entries.map(([key, value]) => [key, withoutSafeIntegerBounds(value)]));
}

mkdirSync(OUT_DIR, { recursive: true });

for (const entry of CONTRACT) {
  const jsonSchema = withoutSafeIntegerBounds(
    z.toJSONSchema(entry.schema, { target: "draft-7" }),
  ) as Record<string, unknown>;
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
