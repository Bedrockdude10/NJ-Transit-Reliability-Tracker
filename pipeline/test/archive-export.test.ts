import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import type { TripStopEvent } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  exportEvents,
  exportedFields,
  partitionKey,
  serialize,
  sqliteColumn,
} from "../src/archive/export-events";
import type { ObjectStore } from "../src/archive/object-store";

/**
 * The export is the offline seam with the Python modelling repo: gzipped JSON
 * Lines, one object per service date, in the field names of
 * `contract/v1/trip-stop-event.schema.json`.
 *
 * The records come from the domain type the contract is generated from, so
 * agreement is structural. What is worth testing is that it stays true against
 * real rows read back out of SQLite — the round trip is where a boolean becomes
 * a 0, or a null becomes absent.
 */

const SCHEMA = JSON.parse(
  readFileSync(resolve(__dirname, "../../contract/v1/trip-stop-event.schema.json"), "utf8"),
) as { properties: Record<string, { type?: string; anyOf?: { type?: string }[] }> };

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "example.invalid",
  accessKeyId: "k",
  secretAccessKey: "s",
  region: "auto",
};

/** Records what was stored, so the round trip can be checked without a server. */
function recordingClient() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    send: async (command: { input: { Key: string; Body: Uint8Array } }) => {
      objects.set(command.input.Key, command.input.Body);
      return {};
    },
  };
}

const EVENT: TripStopEvent = {
  tripId: "T1",
  routeId: "NEC",
  lineName: "Northeast Corridor",
  stopId: "105",
  stopName: "Newark Penn Station",
  stopSequence: 3,
  direction: "inbound",
  serviceDate: "2026-08-11",
  scheduledArrival: 1_786_500_000,
  scheduledDeparture: 1_786_500_060,
  observedArrival: 1_786_500_240,
  delaySeconds: 240,
  stopSkipped: false,
  tripCancelled: false,
  gtfsStaticVersion: "v1",
  ingestedAtMs: 1_786_500_300_000,
};

let db: Database;
let repos: Repositories;

beforeEach(() => {
  db = openDatabase();
  repos = createRepositories(db);
});

/** Column names of the real table, from the migrations. */
function liveColumns(): Set<string> {
  return new Set(
    db
      .all<{ name: string }>("SELECT name FROM pragma_table_info('trip_stop_events')")
      .map((row) => row.name),
  );
}

describe("the records match the contract", () => {
  it("emits exactly the contract's fields, from a row that went through SQLite", async () => {
    // The failure this prevents: a field added to the contract but never written,
    // so the modelling repo generates a model for a column that is always absent.
    repos.events.record(EVENT);
    const client = recordingClient();
    await exportEvents({ repos, store: STORE, serviceDates: ["2026-08-11"], client });

    const [line] = gunzipSync(client.objects.get(partitionKey("events", "2026-08-11"))!)
      .toString()
      .trim()
      .split("\n");
    expect(Object.keys(JSON.parse(line!)).sort()).toEqual(Object.keys(SCHEMA.properties).sort());
  });

  it("round-trips values, not their SQLite encodings", async () => {
    // Booleans are stored 0/1 and epoch fields are integers; a model reading
    // `false` as `0` would train on a column of the wrong type.
    repos.events.record({ ...EVENT, stopSkipped: true, observedArrival: null, delaySeconds: null });
    const client = recordingClient();
    await exportEvents({ repos, store: STORE, serviceDates: ["2026-08-11"], client });

    const record = JSON.parse(
      gunzipSync(client.objects.get(partitionKey("events", "2026-08-11"))!).toString().trim(),
    );
    expect(record.stopSkipped).toBe(true);
    expect(record.tripCancelled).toBe(false);
    expect(record.observedArrival).toBeNull();
    // Present and null, not absent: JSON.stringify drops undefined, which would
    // make a nullable field vanish rather than arrive empty.
    expect("delaySeconds" in record).toBe(true);
    expect(record.delaySeconds).toBeNull();
    expect(record.ingestedAtMs).toBe(EVENT.ingestedAtMs);
  });

  it("derives a column that exists for every contract field", () => {
    // Keeps the contract anchored to the real table even though the export no
    // longer projects columns itself.
    const columns = liveColumns();
    expect(exportedFields().filter((field) => !columns.has(sqliteColumn(field)))).toEqual([]);
  });

  it("covers the table completely, so no column is silently dropped", () => {
    expect(exportedFields().map(sqliteColumn).sort()).toEqual([...liveColumns()].sort());
  });

  it("converts the repo's naming convention", () => {
    expect(sqliteColumn("ingestedAtMs")).toBe("ingested_at_ms");
    expect(sqliteColumn("tripId")).toBe("trip_id");
    expect(sqliteColumn("direction")).toBe("direction");
  });
});

describe("the objects", () => {
  it("partitions by service date so a day can be skipped without being opened", () => {
    expect(partitionKey("events", "2026-08-11")).toBe(
      "events/service_date=2026-08-11/events.jsonl.gz",
    );
    expect(partitionKey("events/", "2026-08-11")).toBe(partitionKey("events", "2026-08-11"));
  });

  it("terminates every line, so concatenating two files stays valid", () => {
    const text = serialize([EVENT, { ...EVENT, tripId: "T2" }]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trim().split("\n")).toHaveLength(2);
  });

  it("skips a day with no events rather than writing an empty one", async () => {
    // An empty object is indistinguishable from a day the pipeline missed, and a
    // model reading it would treat "no trains ran" as fact.
    const client = recordingClient();
    const written = await exportEvents({
      repos,
      store: STORE,
      serviceDates: ["2026-08-11"],
      client,
    });
    expect(written).toEqual([]);
    expect(client.objects.size).toBe(0);
  });

  it("re-exporting a day replaces it rather than adding a second copy", async () => {
    repos.events.record(EVENT);
    const client = recordingClient();
    const options = { repos, store: STORE, serviceDates: ["2026-08-11"], client };
    await exportEvents(options);
    await exportEvents(options);
    expect(client.objects.size).toBe(1);
  });

  it("refuses to report success when the store did not keep what was sent", async () => {
    repos.events.record(EVENT);
    const liar = { send: async () => ({ ETag: '"0000000000000000cafe000000000000"' }) };
    await expect(
      exportEvents({ repos, store: STORE, serviceDates: ["2026-08-11"], client: liar as never }),
    ).rejects.toThrow(/different digest/);
  });
});
