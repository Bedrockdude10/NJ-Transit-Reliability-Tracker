import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createRepositories, openDatabase, type Database, type Repositories } from "@njt/db";
import { FEED_TYPES } from "@njt/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySnapshots, copyableHours, hourStart, snapshotKey } from "../src/archive/copy-snapshots";
import type { ObjectStore } from "../src/archive/object-store";
import { createClient } from "../src/archive/s3-client";

/**
 * The copy deletes the only copy of data NJT does not serve twice. These tests
 * are mostly about what it refuses to do.
 *
 * Runs against MinIO on :9100 (see the Backups section of DEPLOY.md); skipped
 * when it is not up, so the suite stays runnable without Docker.
 */

const STORE: ObjectStore = {
  bucket: "njt-archive",
  endpoint: "localhost:9100",
  accessKeyId: "njtlocal",
  secretAccessKey: "njtlocalsecret",
  region: "us-east-1",
  useSsl: false,
};

const NOW = Date.parse("2026-08-14T12:00:00Z");
const HOUR = 3_600_000;
const online = await fetch("http://localhost:9100/minio/health/live")
  .then((r) => r.ok)
  .catch(() => false);

let dir: string;
let db: Database;
let repos: Repositories;
let prefix: string;

/** Snapshots spread across an hour, one per feed type per slot. */
function seed(hourIso: string, perFeed = 3): void {
  const start = Date.parse(hourIso);
  for (const feedType of FEED_TYPES) {
    for (let i = 0; i < perFeed; i++) {
      repos.snapshots.insert({
        feedType,
        fetchedAtMs: start + i * 60_000,
        rawBytes: randomBytes(2048),
      });
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "njt-copy-"));
  db = openDatabase(join(dir, "njt.sqlite"));
  repos = createRepositories(db);
  prefix = `copy-test/${randomBytes(6).toString("hex")}`;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (over: Partial<Parameters<typeof copySnapshots>[0]> = {}) =>
  copySnapshots({ repos, store: STORE, olderThanHours: 2, prefix, now: () => NOW, ...over });

describe("choosing what to copy", () => {
  it("leaves the retention window alone", () => {
    const range = { firstMs: Date.parse("2026-08-14T08:00:00Z"), lastMs: NOW };
    expect(copyableHours(range, 2, NOW).map((ms) => new Date(ms).toISOString())).toEqual([
      "2026-08-14T08:00:00.000Z",
      "2026-08-14T09:00:00.000Z",
    ]);
  });

  it("never copies the current hour, however small the window", () => {
    // The pipeline is still appending to it; a partially copied hour could gain
    // rows after the copy and lose them in the delete. The hour before it is
    // closed, so a zero window may legitimately take that one.
    const range = { firstMs: NOW - HOUR, lastMs: NOW };
    expect(copyableHours(range, 0, NOW)).not.toContain(hourStart(NOW));
    expect(copyableHours(range, 0, NOW)).toEqual([hourStart(NOW) - HOUR]);
  });

  it("stops after maxHours, leaving the rest for the next run", () => {
    const range = { firstMs: Date.parse("2026-08-14T00:00:00Z"), lastMs: NOW };
    expect(copyableHours(range, 2, NOW, 3).length).toBe(3);
  });

  it("floors an instant to its UTC hour", () => {
    expect(new Date(hourStart(Date.parse("2026-08-14T09:59:59Z"))).toISOString()).toBe(
      "2026-08-14T09:00:00.000Z",
    );
  });

  it("puts everything needed to rebuild the row in the key", () => {
    // Feed type, instant and id: a restore needs no side table to know what an
    // object was.
    expect(
      snapshotKey("snapshots", {
        feedType: "TripUpdates",
        fetchedAtMs: Date.parse("2026-08-11T07:04:05Z"),
        id: 42,
      }),
    ).toBe(
      `snapshots/date=2026-08-11/hour=07/TripUpdates/${Date.parse("2026-08-11T07:04:05Z")}-42.pb`,
    );
  });
});

describe.skipIf(!online)("copying to object storage", () => {
  const client = () => createClient(STORE);

  it("copies an eligible hour and removes it from sqlite", async () => {
    seed("2026-08-14T08:00:00Z");
    seed("2026-08-14T11:30:00Z"); // inside the retention window
    const before = repos.snapshots.count();

    const copied = await run();

    expect(copied.length).toBe(1);
    const [copiedHour] = copied;
    if (copiedHour === undefined) throw new Error("expected one copied hour");
    expect(copiedHour.objects).toBe(FEED_TYPES.length * 3);
    expect(copiedHour.deleted).toBe(copiedHour.objects);
    expect(repos.snapshots.count()).toBe(before - copiedHour.objects);
  }, 60_000);

  it("copies every feed type, not just the busiest", async () => {
    // The archive holds three feeds and the walk is per-feed; a forgotten one
    // would look like an empty one and the hour would be deleted anyway.
    seed("2026-08-14T08:00:00Z", 2);
    await run();

    const listed = await client().send(
      new ListObjectsV2Command({ Bucket: STORE.bucket, Prefix: `${prefix}/` }),
    );
    const feeds = new Set(
      (listed.Contents ?? [])
        .map((o) => o.Key?.split("/").at(-2))
        .filter((feed): feed is string => feed !== undefined),
    );
    expect([...feeds].sort()).toEqual([...FEED_TYPES].sort());
  }, 60_000);

  it("stores the bytes exactly", async () => {
    const bytes = randomBytes(4096);
    repos.snapshots.insert({
      feedType: "TripUpdates",
      fetchedAtMs: Date.parse("2026-08-14T08:15:00Z"),
      rawBytes: bytes,
    });

    const [hour] = await run();
    if (hour === undefined) throw new Error("expected one copied hour");
    expect(hour.objects).toBe(1);

    const listed = await client().send(
      new ListObjectsV2Command({ Bucket: STORE.bucket, Prefix: `${prefix}/` }),
    );
    const key = listed.Contents?.[0]?.Key;
    if (key === undefined) throw new Error("expected the stored object to be listed");
    const got = await client().send(new GetObjectCommand({ Bucket: STORE.bucket, Key: key }));
    const body = got.Body;
    if (body === undefined) throw new Error("expected an object body");
    expect(Buffer.from(await body.transformToByteArray())).toEqual(bytes);
  }, 60_000);

  it("is idempotent — a second run has nothing left to do", async () => {
    seed("2026-08-14T08:00:00Z");
    expect((await run()).length).toBe(1);
    expect(await run()).toEqual([]);
  }, 60_000);

  it("deletes nothing when an upload fails", async () => {
    seed("2026-08-14T08:00:00Z");
    const before = repos.snapshots.count();
    let sent = 0;
    const flaky: typeof fetch = (url, init) => {
      if (++sent === 3) throw new Error("connection reset");
      return fetch(url, init);
    };

    await expect(run({ send: flaky })).rejects.toThrow(/connection reset/u);
    expect(repos.snapshots.count()).toBe(before);
  }, 60_000);

  it("deletes nothing when the store reports a different digest", async () => {
    // Content-MD5 means the store rehashes the body it received, so this is the
    // case where what was stored is not what was sent.
    seed("2026-08-14T08:00:00Z", 1);
    const before = repos.snapshots.count();
    const liar: typeof fetch = async () =>
      new Response(null, {
        status: 200,
        headers: { etag: '"0000000000000000cafe000000000000"' },
      });

    await expect(run({ send: liar })).rejects.toThrow(/different digest/u);
    expect(repos.snapshots.count()).toBe(before);
  }, 60_000);

  it("refuses to delete an hour it could not fully account for", async () => {
    // The repository's count is authoritative; copying fewer objects than it
    // reports means something was missed, and deleting anyway would leave a
    // silent, permanent gap. Simulated by a count one higher than the rows the
    // walk can reach — the shape a skipped feed or a short page would take.
    seed("2026-08-14T08:00:00Z", 1);
    const before = repos.snapshots.count();
    const miscounting = {
      ...repos,
      snapshots: Object.assign(Object.create(Object.getPrototypeOf(repos.snapshots)), repos.snapshots, {
        dayExtent: (from: number, to: number) => ({
          rows: repos.snapshots.dayExtent(from, to).rows + 1,
        }),
      }),
    } as Repositories;

    await expect(run({ repos: miscounting })).rejects.toThrow(/refusing to delete/u);
    expect(repos.snapshots.count()).toBe(before);
  }, 60_000);

  it("stops the file growing without rewriting it", async () => {
    // The point is arresting growth, not shrinking: reclaiming disk needs a
    // VACUUM, which rewrites the whole database.
    for (let h = 0; h < 4; h++) seed(`2026-08-14T0${h}:00:00Z`, 20);
    repos.snapshots.checkpointWal();
    const sizeBefore = statSync(join(dir, "njt.sqlite")).size;

    await run();
    expect(statSync(join(dir, "njt.sqlite")).size).toBeLessThanOrEqual(sizeBefore);

    // Freed pages are reused, so re-adding a similar volume does not grow it.
    for (let h = 0; h < 4; h++) seed(`2026-08-14T1${h}:00:00Z`, 20);
    repos.snapshots.checkpointWal();
    expect(statSync(join(dir, "njt.sqlite")).size).toBeLessThanOrEqual(sizeBefore * 1.1);
  }, 120_000);
});
