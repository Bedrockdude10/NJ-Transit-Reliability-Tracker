import type { Database } from "../database";
import { AggregateRepository } from "./aggregates";
import { ServiceAlertRepository } from "./alerts";
import { TripStopEventRepository } from "./events";
import { GtfsRepository } from "./gtfs";
import { HealthRepository } from "./health";
import { LightRailRepository } from "./lightrail";
import { OfficialMetricRepository } from "./official";
import { RawSnapshotRepository } from "./snapshots";
import { VehiclePositionRepository } from "./vehicles";

export * from "./aggregates";
export * from "./alerts";
export * from "./events";
export * from "./gtfs";
export * from "./health";
export * from "./lightrail";
export * from "./official";
export * from "./snapshots";
export * from "./vehicles";

/** All repositories bound to one database — the single dependency the
 * pipeline and API receive. */
export interface Repositories {
  events: TripStopEventRepository;
  snapshots: RawSnapshotRepository;
  alerts: ServiceAlertRepository;
  gtfs: GtfsRepository;
  official: OfficialMetricRepository;
  lightRail: LightRailRepository;
  aggregates: AggregateRepository;
  health: HealthRepository;
  vehicles: VehiclePositionRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    events: new TripStopEventRepository(db),
    snapshots: new RawSnapshotRepository(db),
    alerts: new ServiceAlertRepository(db),
    gtfs: new GtfsRepository(db),
    official: new OfficialMetricRepository(db),
    lightRail: new LightRailRepository(db),
    aggregates: new AggregateRepository(db),
    health: new HealthRepository(db),
    vehicles: new VehiclePositionRepository(db),
  };
}
