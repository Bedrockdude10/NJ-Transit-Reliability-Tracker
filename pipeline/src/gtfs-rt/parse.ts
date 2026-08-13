import {
  UNKNOWN_LINE_NAME,
  type Direction,
  type EffectType,
  type ServiceAlert,
  type TripStopEvent,
  type VehiclePosition,
  type VehicleStopStatus,
} from "@njt/shared";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime: tr } = GtfsRealtimeBindings;

/** protobufjs returns 64-bit ints as Long objects; normalize to number | null. */
type LongLike = { toNumber(): number };
function num(v: number | string | LongLike | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  return null;
}

/** "YYYYMMDD" (GTFS-RT start_date) -> "YYYY-MM-DD". */
function toServiceDate(startDate: string | null | undefined, fallback: string): string {
  if (startDate && /^\d{8}$/.test(startDate)) {
    return `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`;
  }
  return fallback;
}

/**
 * NJT direction mapping. GTFS `direction_id` 1 is treated as inbound (toward
 * the NYC/terminal anchor), 0 as outbound. This is an assumption documented for
 * the public dataset; the static schedule's direction wins when available.
 */
export function directionFromId(directionId: number | null | undefined): Direction {
  return directionId === 1 ? "inbound" : "outbound";
}

export interface ScheduledStop {
  stopId: string;
  stopSequence: number;
  scheduledArrival: number | null;
  scheduledDeparture: number | null;
}

export interface TripSchedule {
  routeId: string;
  lineName: string;
  direction: Direction;
  stops: ScheduledStop[];
}

/** A route the RT feed reports, resolved onto a canonical catalog line. */
export interface ResolvedRoute {
  routeId: string;
  lineName: string;
}

/** Resolves a trip's static schedule, used to compute scheduled times/delay. */
export interface ScheduleContext {
  lookup(tripId: string, serviceDate: string): TripSchedule | null;
  stopName(stopId: string): string;
  /**
   * Resolve a route_id straight from the RT feed — which reports *source* ids,
   * not the canonical ones GTFS ingest collapses them onto. Used for trips
   * missing from the static schedule, where there's no trip row to go through.
   * Returns null when the id maps to no known line.
   */
  resolveRoute(routeId: string): ResolvedRoute | null;
}

export interface ParseOptions {
  now: number;
  /** Service date to use when a trip has no start_date. */
  defaultServiceDate: string;
  gtfsStaticVersion: string;
  /** Called when an RT trip can't be matched to the static schedule. */
  onTripMismatch?: (tripId: string) => void;
}

const EFFECT_MAP: Record<number, EffectType> = {
  1: "no_service",
  2: "reduced_service",
  3: "delay",
  4: "detour",
  5: "additional_service",
  6: "modified_service",
  7: "other",
  8: "unknown",
  9: "stop_moved",
  10: "other",
  11: "other",
};

const CANCELED = tr.TripDescriptor.ScheduleRelationship.CANCELED;
const STU_SKIPPED = tr.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;

function firstTranslation(text: { translation?: { text?: string | null }[] | null } | null | undefined): string {
  return text?.translation?.[0]?.text ?? "";
}

/**
 * Decode a TripUpdates FeedMessage into one {@link TripStopEvent} per stop-time
 * update. Scheduled times come from the static schedule when matched; otherwise
 * they're derived from the predicted time minus the reported delay.
 */
export function parseTripUpdates(buffer: Uint8Array, ctx: ScheduleContext, opts: ParseOptions): TripStopEvent[] {
  // NJT returns an empty body when the feed has no entities (200, 0 bytes);
  // that's an empty feed, not a decode error.
  if (buffer.length === 0) return [];
  const feed = tr.FeedMessage.decode(buffer);
  const events: TripStopEvent[] = [];

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu?.trip) continue;

    const tripId = tu.trip.tripId ?? "";
    const serviceDate = toServiceDate(tu.trip.startDate, opts.defaultServiceDate);
    const schedule = ctx.lookup(tripId, serviceDate);
    if (!schedule) opts.onTripMismatch?.(tripId);

    // The RT feed reports *source* route ids, which GTFS ingest collapses onto
    // canonical lines. With no static schedule to resolve through, go via the
    // alias map — storing the raw id as a line name poisons every aggregate
    // keyed by line (a station reporting service on a line called "10").
    const rtRoute = schedule ? null : ctx.resolveRoute(tu.trip.routeId ?? "");
    const routeId = schedule?.routeId ?? rtRoute?.routeId ?? tu.trip.routeId ?? "";
    const lineName = schedule?.lineName ?? rtRoute?.lineName ?? UNKNOWN_LINE_NAME;
    const direction = schedule?.direction ?? directionFromId(tu.trip.directionId);
    const cancelled = tu.trip.scheduleRelationship === CANCELED;
    const scheduledByStop = new Map(schedule?.stops.map((s) => [s.stopId, s]) ?? []);

    const base = { tripId, routeId, lineName, direction, serviceDate, gtfsStaticVersion: opts.gtfsStaticVersion, ingestedAtMs: opts.now };

    if (cancelled && schedule) {
      // A cancelled trip: mark each scheduled stop cancelled so terminal OTP sees it.
      for (const stop of schedule.stops) {
        events.push({
          ...base,
          stopId: stop.stopId,
          stopName: ctx.stopName(stop.stopId),
          stopSequence: stop.stopSequence,
          scheduledArrival: stop.scheduledArrival,
          scheduledDeparture: stop.scheduledDeparture,
          observedArrival: null,
          delaySeconds: null,
          stopSkipped: false,
          tripCancelled: true,
        });
      }
      continue;
    }

    for (const stu of tu.stopTimeUpdate ?? []) {
      const stopId = stu.stopId ?? "";
      const scheduled = scheduledByStop.get(stopId);
      const observedArrival = num(stu.arrival?.time);
      const reportedDelay = num(stu.arrival?.delay);
      const scheduledArrival = scheduled?.scheduledArrival ?? (observedArrival !== null && reportedDelay !== null ? observedArrival - reportedDelay : null);
      const delaySeconds =
        reportedDelay ?? (observedArrival !== null && scheduledArrival !== null ? observedArrival - scheduledArrival : null);

      events.push({
        ...base,
        stopId,
        stopName: ctx.stopName(stopId),
        stopSequence: stu.stopSequence ?? scheduled?.stopSequence ?? 0,
        scheduledArrival,
        scheduledDeparture: scheduled?.scheduledDeparture ?? null,
        observedArrival,
        delaySeconds,
        stopSkipped: stu.scheduleRelationship === STU_SKIPPED,
        tripCancelled: false,
      });
    }
  }

  return events;
}

const STOP_STATUS_MAP: Record<number, VehicleStopStatus> = {
  0: "incoming_at",
  1: "stopped_at",
  2: "in_transit_to",
};

/**
 * Decode a VehiclePositions FeedMessage into {@link VehiclePosition}s.
 *
 * Route ids come from the RT feed in *source* form, so they're resolved onto
 * canonical lines the same way trip updates are. Entities without a usable
 * latitude/longitude are dropped: a vehicle with no position can't be mapped,
 * and a 0/0 placeholder would render off the coast of Africa.
 */
export function parseVehiclePositions(
  buffer: Uint8Array,
  ctx: ScheduleContext,
  opts: { now: number; defaultServiceDate: string },
): VehiclePosition[] {
  if (buffer.length === 0) return [];
  const feed = tr.FeedMessage.decode(buffer);
  const positions: VehiclePosition[] = [];

  for (const entity of feed.entity) {
    const vp = entity.vehicle;
    if (!vp) continue;

    const latitude = vp.position?.latitude ?? null;
    const longitude = vp.position?.longitude ?? null;
    if (latitude === null || longitude === null) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude === 0 && longitude === 0) continue;

    const tripId = vp.trip?.tripId ?? null;
    const serviceDate = toServiceDate(vp.trip?.startDate, opts.defaultServiceDate);
    const schedule = tripId ? ctx.lookup(tripId, serviceDate) : null;
    const route = schedule ? null : ctx.resolveRoute(vp.trip?.routeId ?? "");

    const stopId = vp.stopId ?? null;

    positions.push({
      // NJT populates vehicle.id; fall back to the entity id so a feed that
      // omits it still yields distinct rows rather than collapsing to one.
      vehicleId: vp.vehicle?.id || entity.id,
      tripId,
      routeId: schedule?.routeId ?? route?.routeId ?? null,
      lineName: schedule?.lineName ?? route?.lineName ?? null,
      direction: schedule?.direction ?? (vp.trip?.directionId === undefined || vp.trip?.directionId === null
        ? null
        : directionFromId(vp.trip.directionId)),
      latitude,
      longitude,
      bearing: vp.position?.bearing ?? null,
      speedMetersPerSecond: vp.position?.speed ?? null,
      stopId,
      stopName: stopId ? ctx.stopName(stopId) : null,
      status: vp.currentStatus === undefined || vp.currentStatus === null ? null : (STOP_STATUS_MAP[vp.currentStatus] ?? null),
      reportedAt: num(vp.timestamp),
      ingestedAtMs: opts.now,
    });
  }

  return positions;
}

/** Decode a ServiceAlerts FeedMessage into {@link ServiceAlert}s. */
export function parseServiceAlerts(buffer: Uint8Array, opts: { now: number }): ServiceAlert[] {
  // Empty body = no active alerts (a successful poll), not a decode error.
  if (buffer.length === 0) return [];
  const feed = tr.FeedMessage.decode(buffer);
  const alerts: ServiceAlert[] = [];

  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;

    const informed = alert.informedEntity ?? [];
    const routes = [...new Set(informed.map((e) => e.routeId).filter((r): r is string => !!r))];
    const stops = [...new Set(informed.map((e) => e.stopId).filter((s): s is string => !!s))];
    const period = alert.activePeriod?.[0];

    alerts.push({
      alertId: entity.id,
      affectedRoutes: routes,
      affectedStops: stops,
      headerText: firstTranslation(alert.headerText),
      descriptionText: firstTranslation(alert.descriptionText),
      effectType: EFFECT_MAP[alert.effect ?? 8] ?? "unknown",
      activeFrom: num(period?.start),
      activeTo: num(period?.end),
      ingestedAtMs: opts.now,
    });
  }

  return alerts;
}
