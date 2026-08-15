import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, DATASETS, datasetKey } from "../src/datasets";

/**
 * The bucket layout is a contract with another repo that shares no code with
 * this one.
 *
 * The record schemas were already generated and diffed in both directions. The
 * layout was not — it was written out once here and once in the modelling repo's
 * reader, with nothing comparing them, which is the drift that fails silently:
 * a reader looking under the wrong prefix, or for the wrong suffix, finds no
 * objects and reports success.
 */

const CONTRACT = resolve(__dirname, "../../contract", CONTRACT_VERSION);

function emitted(): {
  version: string;
  datasets: Record<string, { prefix: string; format: string; schema: string | null }>;
} {
  return JSON.parse(readFileSync(resolve(CONTRACT, "datasets.json"), "utf8"));
}

describe("the emitted layout matches the code that writes it", () => {
  it("is regenerated — the checked-in file equals the table", () => {
    // The same guard the generated Zod has: `npm run emit:data-contract` is not
    // optional, because the modelling repo reads the file, not the table.
    expect(emitted().datasets).toEqual(DATASETS);
    expect(emitted().version).toBe(CONTRACT_VERSION);
  });

  it("names a schema file that exists, for every dataset that has records", () => {
    // A dangling reference would generate no pydantic model on the other side,
    // and the dataset would be unreadable there while looking fine here.
    for (const [name, dataset] of Object.entries(DATASETS)) {
      if (dataset.schema === null) continue;
      expect(() => readFileSync(resolve(CONTRACT, dataset.schema!)), name).not.toThrow();
    }
  });

  it("builds the key both repos have to agree on", () => {
    expect(datasetKey("events", "2026-08-14")).toBe(
      "events/service_date=2026-08-14/events.jsonl.gz",
    );
    expect(datasetKey("predictions", "2026-08-14")).toBe(
      "predictions/service_date=2026-08-14/predictions.parquet",
    );
  });

  it("gives every dataset its own prefix, so one cannot read another's objects", () => {
    const prefixes = Object.values(DATASETS).map((dataset) => dataset.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("records which repo writes each dataset", () => {
    // Not enforcement — a note about direction. `events` flowing the other way
    // would mean the modelling repo had started deriving what ingest observes.
    expect(DATASETS.events.producer).toBe("njt-reliability-tracker");
    expect(DATASETS.predictions.producer).toBe("njt-delay-modeling");
  });
});

describe("the contract digest", () => {
  it("covers every file in the contract directory", () => {
    // The consumer compares this against what the deployed producer publishes,
    // so a schema left out of it would be a change nobody could detect.
    const manifest = JSON.parse(readFileSync(resolve(CONTRACT, "manifest.json"), "utf8")) as {
      digest: string;
      files: Record<string, string>;
    };
    for (const dataset of Object.values(DATASETS)) {
      if (dataset.schema) expect(Object.keys(manifest.files)).toContain(dataset.schema);
    }
    expect(Object.keys(manifest.files)).toContain("datasets.json");
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
