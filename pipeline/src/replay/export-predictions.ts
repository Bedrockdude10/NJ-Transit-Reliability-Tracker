import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { toLocalDateString } from "@njt/shared";
import { parseTripUpdates } from "../gtfs-rt/parse";
import { createScheduleCache, createScheduleContext } from "../gtfs-rt/schedule-context";

/**
 * Export every prediction in the archive as a flat, gzipped CSV for analysis.
 *
 * `trip_stop_events` keeps one row per stop — the final answer. The archive
 * holds *every* forecast NJT published on the way there, roughly 600 per poll
 * and a couple of hundred per stop. That is a different dataset, and the only
 * one that can answer "how far ahead was this knowable?" and "how much should a
 * rider trust the number on screen?".
 *
 * This is deliberately an ETL step and nothing more: decode, flatten, write.
 * No statistics live here. Protobuf is the one thing a columnar engine cannot
 * read for itself, so this exists purely to hand DuckDB something it can query.
 *
 * Constant memory by construction — rows stream straight out, and the writer
 * is respected via backpressure. Buffering 50M rows is what killed the earlier
 * attempts at this.
 */

export interface ExportOptions {
  fromDate?: string;
  toDate?: string;
  onProgress?: (polls: number, rows: number) => void;
}

const PAGE_SIZE = 100;
const HEADER = "trip_id,stop_id,line_name,route_id,direction,service_date,observed_at,scheduled_arrival,lead_seconds,predicted_delay,cancelled,skipped\n";

/** CSV-quote a value that may contain commas (line names do). */
function q(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function exportPredictions(
  repos: Repositories,
  outPath: string,
  options: ExportOptions = {},
): Promise<{ polls: number; rows: number }> {
  const gzip = createGzip();
  const file = createWriteStream(outPath);
  gzip.pipe(file);

  /** Write, pausing when the stream asks us to. */
  const write = async (chunk: string): Promise<void> => {
    if (!gzip.write(chunk)) await new Promise<void>((r) => gzip.once("drain", () => r()));
  };

  await write(HEADER);

  const extent = repos.snapshots.extent("TripUpdates");
  const fromMs = options.fromDate ? Date.parse(`${options.fromDate}T00:00:00Z`) - 6 * 3600e3 : (extent?.firstMs ?? 0);
  const toMs = options.toDate ? Date.parse(`${options.toDate}T00:00:00Z`) + 36 * 3600e3 : (extent?.lastMs ?? 0);

  const cache = createScheduleCache();
  let afterId = 0;
  let polls = 0;
  let rows = 0;
  let buffer = "";

  for (;;) {
    const page = repos.snapshots.pageByTime("TripUpdates", fromMs, toMs, afterId, PAGE_SIZE);
    if (page.length === 0) break;

    for (const snapshot of page) {
      afterId = snapshot.id ?? afterId;
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

      // Flush in batches rather than per row: 50M individual writes is most of
      // the runtime, and one string per poll keeps memory flat regardless.
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

// --- CLI ---------------------------------------------------------------------

if (process.argv[1]?.endsWith("export-predictions.ts")) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const repos = createRepositories(openDatabase(process.env.NJT_DB_PATH ?? "./data/njt.sqlite"));
  const out = arg("out") ?? "./predictions.csv.gz";
  let lastReport = 0;

  const result = await exportPredictions(repos, out, {
    fromDate: arg("from"),
    toDate: arg("to"),
    onProgress: (polls, rows) => {
      if (polls - lastReport < 2000) return;
      lastReport = polls;
      console.error(`  ${polls.toLocaleString()} polls -> ${rows.toLocaleString()} rows`);
    },
  });
  console.error(`done: ${result.polls.toLocaleString()} polls -> ${result.rows.toLocaleString()} rows -> ${out}`);
}
