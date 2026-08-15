/**
 * Every dataset exchanged through object storage: where it lives, how it is
 * encoded, and which repo writes it.
 *
 * The record *schemas* were already generated from here into `contract/v1` and
 * regenerated into pydantic on the other side, so a renamed field fails loudly.
 * Everything around the records was not: the key layout, the prefix, the
 * encoding and the partition key were each written out twice — once in this
 * repo's exporter, once in the modelling repo's reader — with nothing comparing
 * them. That is the more dangerous half. A reader looking under the wrong prefix,
 * or for `.parquet` where `.jsonl.gz` is written, finds nothing and reports
 * success; the model then trains on an empty frame rather than failing.
 *
 * So this table is emitted as `contract/v1/datasets.json` and both sides build
 * their keys from it. Neither repo may hardcode a prefix or a suffix.
 */

/**
 * How a dataset is encoded.
 *
 * The rule, where there is a choice: **the constrained end decides**. Both
 * tabular datasets cross between a 512 MB machine that also serves the site and a
 * workstation, and whichever side is short of memory should not be the one paying
 * for a columnar reader or writer. `parquet` remains available for a dataset that
 * never touches the small machine.
 */
export type DatasetFormat = "jsonl.gz" | "parquet" | "protobuf";

/** Which repo is allowed to write a dataset. The other only reads it. */
export type DatasetProducer = "njt-reliability-tracker" | "njt-delay-modeling";

export interface DatasetDescriptor {
  /** Key prefix, without leading or trailing slashes. */
  prefix: string;
  format: DatasetFormat;
  /**
   * Hive partition key, so a consumer can skip whole partitions from the path
   * without opening an object.
   */
  partitionBy: string;
  /** Base name of the object inside each partition, without its extension. */
  objectName: string;
  /**
   * The schema file in this directory describing one record, or null where the
   * payload is opaque bytes rather than rows.
   */
  schema: string | null;
  producer: DatasetProducer;
  description: string;
}

export const CONTRACT_VERSION = "v1";

export const DATASETS = {
  events: {
    prefix: "events",
    format: "jsonl.gz",
    partitionBy: "service_date",
    objectName: "events",
    schema: "trip-stop-event.schema.json",
    producer: "njt-reliability-tracker",
    description:
      "One observed reading per (trip, stop, service date). Gzipped JSON Lines because the " +
      "producer runs on a 512 MB machine that also serves the API, where a columnar writer " +
      "cost more resident memory than the machine had spare.",
  },
  predictions: {
    prefix: "predictions",
    format: "jsonl.gz",
    partitionBy: "service_date",
    objectName: "predictions",
    schema: "delay-prediction.schema.json",
    producer: "njt-delay-modeling",
    description:
      "A predicted terminal delay. Gzipped JSON Lines for the same reason events are, " +
      "with the ends reversed: the consumer is the 512 KB-per-request API on a 512 MB " +
      "machine, and the encoding follows whichever end is constrained.",
  },
  scorecards: {
    prefix: "scorecards",
    format: "jsonl.gz",
    partitionBy: "service_date",
    objectName: "scorecards",
    schema: "model-scorecard.schema.json",
    producer: "njt-delay-modeling",
    description: "Per-model, per-day accuracy summary.",
  },
  snapshots: {
    prefix: "snapshots",
    format: "protobuf",
    partitionBy: "date",
    objectName: "snapshots",
    schema: null,
    producer: "njt-reliability-tracker",
    description:
      "The raw GTFS-RT archive, one object per fetched payload, kept so parsing can be re-run " +
      "over history. Opaque bytes: no record schema, and not an analytical dataset.",
  },
} as const satisfies Record<string, DatasetDescriptor>;

export type DatasetName = keyof typeof DATASETS;

export function datasetDescriptor(name: DatasetName): DatasetDescriptor {
  return DATASETS[name];
}

/**
 * The object key for one partition of a dataset.
 *
 * The single definition of the layout. `partitionKey("events", "2026-08-14")` is
 * `events/service_date=2026-08-14/events.jsonl.gz`, and the modelling repo builds
 * the identical key from the same descriptor rather than from a copy of this
 * rule.
 */
export function datasetKey(name: DatasetName, partition: string): string {
  const { prefix, partitionBy, objectName, format } = DATASETS[name];
  return `${prefix}/${partitionBy}=${partition}/${objectName}.${format}`;
}
