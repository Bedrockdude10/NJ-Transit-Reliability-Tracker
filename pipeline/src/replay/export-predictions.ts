import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { parseTripUpdates } from "../gtfs-rt/parse";
import { createScheduleCache, createScheduleContext } from "../gtfs-rt/schedule-context";

/**
 * Export every forecast in the archive (not just the final one per stop) as a flat
 * gzipped CSV — decode, flatten, write, no statistics. Must stay constant-memory:
 * it streams and respects writer backpressure, since ~50M rows will not fit.
 */

export interface ExportOptions {
  fromDate?: string;
  toDate?: string;
  onProgress?: (polls: number, rows: number) => void;
}

const PAGE_SIZE = 100;
const HEADER = "trip_id,stop_id,line_name,route_id,direction,service_date,observed_at,scheduled_arrival,lead_seconds,predicted_delay,cancelled,skipped\n";

function q(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}

export async function exportPredictions(
  repos: Repositories,
  outPath: string,
  options: ExportOptions = {},
): Promise<{ polls: number; rows: number }> {
  const gzip = createGzip();
  const file = createWriteStream(outPath);
  gzip.pipe(file);

  const write = async (chunk: string): Promise<void> => {
    if (!gzip.write(chunk)) await new Promise<void>((r) => gzip.once("drain", () => r()));
  };

  await write(HEADER);

  // Bounds filtered per row, not in SQL: a `fetched_at_ms` predicate sends SQLite to
  // the time index and costs a full sort per page. Walking ids is far cheaper.
  const fromMs = options.fromDate ? Date.parse(`${options.fromDate}T00:00:00Z`) - 6 * 3600e3 : -Infinity;
  const toMs = options.toDate ? Date.parse(`${options.toDate}T00:00:00Z`) + 36 * 3600e3 : Infinity;

  const cache = createScheduleCache();
  let afterId = 0;
  let polls = 0;
  let rows = 0;
  let buffer = "";

  for (;;) {
    const page = repos.snapshots.pageById("TripUpdates", afterId, PAGE_SIZE);
    if (page.length === 0) break;

    for (const snapshot of page) {
      afterId = snapshot.id ?? afterId;
      if (snapshot.fetchedAtMs < fromMs || snapshot.fetchedAtMs > toMs) continue;
      polls++;

      const observedAt = Math.floor(snapshot.fetchedAtMs / 1000);
      const version = repos.gtfs.versionAt(observedAt) ?? repos.gtfs.currentVersion();
      if (!version) continue;

      const ctx = createScheduleContext(repos.gtfs, cache, version.versionId);
      const events = parseTripUpdates(snapshot.rawBytes, ctx, {
        now: snapshot.fetchedAtMs,
        defaultServiceDate: toLocalDateString(observedAt),
        gtfsStaticVersion: version.versionId,
      });

      for (const e of events) {
        if (e.scheduledArrival === null) continue;
        buffer +=
          `${q(e.tripId)},${q(e.stopId)},${q(e.lineName)},${q(e.routeId)},${e.direction},${e.serviceDate},` +
          `${observedAt},${e.scheduledArrival},${e.scheduledArrival - observedAt},${e.delaySeconds ?? ""},` +
          `${e.tripCancelled ? 1 : 0},${e.stopSkipped ? 1 : 0}\n`;
        rows++;
      }

      // Batched flush: 50M individual writes is most of the runtime.
      if (buffer.length > 1_000_000) {
        await write(buffer);
        buffer = "";
      }
    }

    options.onProgress?.(polls, rows);
    if (page.length < PAGE_SIZE) break;
  }

  if (buffer) await write(buffer);

  await new Promise<void>((resolve, reject) => {
    file.on("finish", () => resolve());
    file.on("error", reject);
    gzip.end();
  });

  return { polls, rows };
}


if (process.argv[1]?.endsWith("export-predictions.ts")) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const repos = createRepositories(openDatabase(process.env.NJT_DB_PATH ?? "./data/njt.sqlite"));
  const out = arg("out") ?? "./predictions.csv.gz";
  let lastReport = 0;

  const fromDate = arg("from");
  const toDate = arg("to");
  const result = await exportPredictions(repos, out, {
    ...(fromDate !== undefined ? { fromDate } : {}),
    ...(toDate !== undefined ? { toDate } : {}),
    onProgress: (polls, rows) => {
      if (polls - lastReport < 2000) return;
      lastReport = polls;
      console.error(`  ${polls.toLocaleString()} polls -> ${rows.toLocaleString()} rows`);
    },
  });
  console.error(`done: ${result.polls.toLocaleString()} polls -> ${result.rows.toLocaleString()} rows -> ${out}`);
}
