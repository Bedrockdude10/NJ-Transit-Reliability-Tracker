import type { EffectType, ServiceAlert } from "@njt/shared";
import type { Database } from "../database";
import { parseStringArray, serializeJson } from "../json";

interface AlertRow {
  alert_id: string;
  affected_routes: string;
  affected_stops: string;
  header_text: string;
  description_text: string;
  effect_type: string;
  active_from: number | null;
  active_to: number | null;
  first_seen_ms: number;
  last_seen_ms: number;
}

function toAlert(row: AlertRow): ServiceAlert {
  return {
    alertId: row.alert_id,
    affectedRoutes: parseStringArray(row.affected_routes),
    affectedStops: parseStringArray(row.affected_stops),
    headerText: row.header_text,
    descriptionText: row.description_text,
    effectType: row.effect_type as EffectType,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    ingestedAtMs: row.first_seen_ms,
  };
}

export interface AlertQuery {
  /** A route_id. */
  route?: string;
  effectType?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
}

export interface AlertFrequencyRow {
  route: string;
  effectType: string;
  count: number;
}

export class ServiceAlertRepository {
  constructor(private readonly db: Database) {}

  /** Refreshing an existing alert keeps its first_seen_ms. */
  upsert(alert: ServiceAlert): void {
    this.db
      .prepare(
        /* sql */ `
        INSERT INTO service_alerts (
          alert_id, affected_routes, affected_stops, header_text, description_text,
          effect_type, active_from, active_to, first_seen_ms, last_seen_ms
        ) VALUES (
          :id, :routes, :stops, :header, :description,
          :effect, :from, :to, :seen, :seen
        )
        ON CONFLICT(alert_id) DO UPDATE SET
          affected_routes  = excluded.affected_routes,
          affected_stops   = excluded.affected_stops,
          header_text      = excluded.header_text,
          description_text = excluded.description_text,
          effect_type      = excluded.effect_type,
          active_from      = excluded.active_from,
          active_to        = excluded.active_to,
          last_seen_ms     = excluded.last_seen_ms
      `,
      )
      .run({
        id: alert.alertId,
        routes: serializeJson(alert.affectedRoutes),
        stops: serializeJson(alert.affectedStops),
        header: alert.headerText,
        description: alert.descriptionText,
        effect: alert.effectType,
        from: alert.activeFrom,
        to: alert.activeTo,
        seen: alert.ingestedAtMs,
      });
  }

  private buildFilter(query: AlertQuery): { where: string; params: Record<string, string | number> } {
    const clauses: string[] = [];
    const params: Record<string, string | number> = {};
    if (query.route !== undefined) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(affected_routes) WHERE value = :route)");
      params.route = query.route;
    }
    if (query.effectType !== undefined) {
      clauses.push("effect_type = :effect");
      params.effect = query.effectType;
    }
    if (query.fromMs !== undefined) {
      clauses.push("first_seen_ms >= :from");
      params.from = query.fromMs;
    }
    if (query.toMs !== undefined) {
      clauses.push("first_seen_ms <= :to");
      params.to = query.toMs;
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  list(query: AlertQuery): { alerts: ServiceAlert[]; total: number } {
    const { where, params } = this.buildFilter(query);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM service_alerts ${where}`, params)?.c ?? 0;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const alerts = this.db
      .all<AlertRow>(
        `SELECT * FROM service_alerts ${where} ORDER BY first_seen_ms DESC LIMIT :limit OFFSET :offset`,
        { ...params, limit, offset },
      )
      .map(toAlert);
    return { alerts, total };
  }

  /** Window in epoch ms. */
  frequency(fromMs: number, toMs: number): AlertFrequencyRow[] {
    return this.db.all<AlertFrequencyRow>(
      /* sql */ `
        SELECT je.value AS route, a.effect_type AS effectType, COUNT(*) AS count
        FROM service_alerts a, json_each(a.affected_routes) je
        WHERE a.first_seen_ms BETWEEN :from AND :to
        GROUP BY je.value, a.effect_type
        ORDER BY je.value, a.effect_type
      `,
      { from: fromMs, to: toMs },
    );
  }
}
