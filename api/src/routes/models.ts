import type { Repositories } from "@njt/db";
import type {
  ModelAccuracy,
  ModelAccuracyResponse,
  ModelHorizonAccuracy,
  ModelScorecard,
} from "@njt/shared";
import { Hono } from "hono";
import { CACHE_CONTROL_MINUTE } from "../util";

const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Weighted by the legs each row scored. A mean of per-horizon means would weight
 * ten stops ahead — where there are fewest pairs and the error is largest — as
 * heavily as one stop ahead.
 */
function weighted(cards: readonly ModelScorecard[], of: (card: ModelScorecard) => number): number {
  const legs = cards.reduce((total, card) => total + card.predictions, 0);
  if (legs === 0) return 0;
  return cards.reduce((total, card) => total + of(card) * card.predictions, 0) / legs;
}

function groupBy<Key, Row>(rows: readonly Row[], key: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const existing = groups.get(key(row));
    if (existing) existing.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * `horizonSeconds` is the *median* scheduled gap for a horizon, so it is only a
 * stable key while the service dates are complete: a truncated partition reports
 * different medians and its horizons appear alongside rather than merged.
 */
function horizonsOf(cards: readonly ModelScorecard[]): ModelHorizonAccuracy[] {
  return [...groupBy(cards, (card) => card.horizonSeconds)]
    .map(([horizonSeconds, rows]) => ({
      horizonSeconds,
      predictions: rows.reduce((total, row) => total + row.predictions, 0),
      maeSeconds: weighted(rows, (row) => row.maeSeconds),
      biasSeconds: weighted(rows, (row) => row.biasSeconds),
      falselyReassuringPercent: weighted(rows, (row) => row.falselyReassuringPercent),
    }))
    .sort((a, b) => a.horizonSeconds - b.horizonSeconds);
}

export function modelRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const requested = c.req.query("date");
    if (requested !== undefined && !SERVICE_DATE.test(requested)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }

    const cards = requested
      ? repos.scorecards.forServiceDate(requested)
      : repos.scorecards.all();

    const models: ModelAccuracy[] = [...groupBy(cards, (card) => card.modelVersion)]
      .map(([modelVersion, rows]) => ({
        modelVersion,
        runIds: unique(rows.map((row) => row.runId)),
        serviceDates: unique(rows.map((row) => row.serviceDate)),
        predictions: rows.reduce((total, row) => total + row.predictions, 0),
        maeSeconds: weighted(rows, (row) => row.maeSeconds),
        biasSeconds: weighted(rows, (row) => row.biasSeconds),
        horizons: horizonsOf(rows),
      }))
      .sort((a, b) => a.modelVersion.localeCompare(b.modelVersion));

    const response: ModelAccuracyResponse = {
      serviceDate: requested ?? null,
      available: models.length > 0,
      availableDates: repos.scorecards.serviceDates(),
      models,
    };

    c.header("Cache-Control", CACHE_CONTROL_MINUTE);
    return c.json(response);
  });

  return router;
}
