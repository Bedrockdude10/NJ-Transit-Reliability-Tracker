import type { z } from "zod";
import { describe, expect, it } from "vitest";
import * as schemas from "../src/api.zod";
import type * as dto from "../src/api";
import type { Direction, VehicleStopStatus } from "../src/domain";
import type { CertificateBand, HeatmapType } from "../src/constants";

/**
 * `api.zod.ts` is generated from `api.ts`, and generated code rots the moment
 * someone edits the source without rerunning the generator. These assertions
 * are the guard: they are compile-time, so `npm run typecheck` fails on drift
 * whether or not anyone runs the tests.
 *
 * `Exact` is deliberately stricter than assignability. `extends` would accept a
 * schema that had dropped a field or widened a union — precisely the drift
 * worth catching — so it compares the two types by identity instead.
 */

type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/** Compiles only when the schema infers exactly its interface. */
function assertExact<A, B>(_proof: Exact<A, B> extends true ? true : never): void {}

type Inferred<S> = S extends z.ZodType ? z.infer<S> : never;

describe("generated schemas match the interfaces they came from", () => {
  it("infers exactly the declared response types", () => {
    // The unions the generator inlines, checked against the originals so
    // an edit in domain.ts or constants.ts cannot silently diverge.
    assertExact<Inferred<typeof schemas.directionSchema>, Direction>(true);
    assertExact<Inferred<typeof schemas.vehicleStopStatusSchema>, VehicleStopStatus>(true);
    assertExact<Inferred<typeof schemas.heatmapTypeSchema>, HeatmapType>(true);
    assertExact<Inferred<typeof schemas.certificateBandSchema>, CertificateBand>(true);

    // Every response the app can receive.
    assertExact<Inferred<typeof schemas.healthResponseSchema>, dto.HealthResponse>(true);
    assertExact<Inferred<typeof schemas.systemSummaryResponseSchema>, dto.SystemSummaryResponse>(true);
    assertExact<Inferred<typeof schemas.heatmapResponseSchema>, dto.HeatmapResponse>(true);
    assertExact<Inferred<typeof schemas.lineListResponseSchema>, dto.LineListResponse>(true);
    assertExact<Inferred<typeof schemas.mapResponseSchema>, dto.MapResponse>(true);
    assertExact<Inferred<typeof schemas.mapVehiclesResponseSchema>, dto.MapVehiclesResponse>(true);
    assertExact<Inferred<typeof schemas.trendsResponseSchema>, dto.TrendsResponse>(true);
    assertExact<Inferred<typeof schemas.historyResponseSchema>, dto.HistoryResponse>(true);
    assertExact<Inferred<typeof schemas.lightRailSummaryResponseSchema>, dto.LightRailSummaryResponse>(true);
    assertExact<Inferred<typeof schemas.lineSummaryResponseSchema>, dto.LineSummaryResponse>(true);
    assertExact<Inferred<typeof schemas.lineTrendResponseSchema>, dto.LineTrendResponse>(true);
    assertExact<Inferred<typeof schemas.lineMonthlyResponseSchema>, dto.LineMonthlyResponse>(true);
    assertExact<Inferred<typeof schemas.worstTripsResponseSchema>, dto.WorstTripsResponse>(true);
    assertExact<Inferred<typeof schemas.propagationResponseSchema>, dto.PropagationResponse>(true);
    assertExact<Inferred<typeof schemas.stationListResponseSchema>, dto.StationListResponse>(true);
    assertExact<Inferred<typeof schemas.stationRankingsResponseSchema>, dto.StationRankingsResponse>(true);
    assertExact<Inferred<typeof schemas.stationDeparturesResponseSchema>, dto.StationDeparturesResponse>(true);
    assertExact<Inferred<typeof schemas.stationSummaryResponseSchema>, dto.StationSummaryResponse>(true);
    assertExact<Inferred<typeof schemas.commuteResponseSchema>, dto.CommuteResponse>(true);
    assertExact<Inferred<typeof schemas.connectionResponseSchema>, dto.ConnectionResponse>(true);
    assertExact<Inferred<typeof schemas.connectionTopResponseSchema>, dto.ConnectionTopResponse>(true);
    assertExact<Inferred<typeof schemas.alertListResponseSchema>, dto.AlertListResponse>(true);
    assertExact<Inferred<typeof schemas.alertFrequencyResponseSchema>, dto.AlertFrequencyResponse>(true);
    assertExact<Inferred<typeof schemas.trainRecordResponseSchema>, dto.TrainRecordResponse>(true);
    assertExact<Inferred<typeof schemas.certificateResponseSchema>, dto.CertificateResponse>(true);

    // The assertions above are the test; reaching here means they compiled.
    expect(true).toBe(true);
  });
});

/**
 * A sample of runtime behaviour, mostly to pin what the schemas do with input
 * they were not given — the failure mode that motivated them.
 */
describe("contract validation at runtime", () => {
  const health: dto.HealthResponse = {
    collectionStartDate: "2026-07-01",
    uptimePercent: 99.4,
    feeds: [
      {
        feedType: "TripUpdates",
        lastSuccessAtMs: 1_786_622_400_000,
        lastFailureAtMs: null,
        pollsToday: 2_880,
        failuresToday: 0,
      },
    ],
    knownGaps: [],
    officialCoverage: [],
    generatedAtMs: 1_786_622_400_000,
  };

  it("accepts a well-formed response", () => {
    expect(schemas.healthResponseSchema.parse(health)).toEqual(health);
  });

  it("rejects a response missing a field", () => {
    const { uptimePercent: _dropped, ...missing } = health;
    expect(schemas.healthResponseSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a field of the wrong type", () => {
    // The skew case: a number becomes a string across a deploy boundary.
    expect(
      schemas.healthResponseSchema.safeParse({ ...health, uptimePercent: "99.4" }).success,
    ).toBe(false);
  });

  it("distinguishes null from absent", () => {
    // `lastFailureAtMs` is nullable and required — null is data, missing is not.
    const feed = health.feeds[0];
    if (feed === undefined) throw new Error("fixture has no feeds");
    const feeds = [{ ...feed, lastFailureAtMs: undefined }];
    expect(schemas.healthResponseSchema.safeParse({ ...health, feeds }).success).toBe(false);
  });

  it("names the offending path when it rejects", () => {
    const feed = health.feeds[0];
    if (feed === undefined) throw new Error("fixture has no feeds");
    const result = schemas.healthResponseSchema.safeParse({
      ...health,
      feeds: [{ ...feed, pollsToday: "many" }],
    });
    expect(result.success).toBe(false);
    // Without the path, a validation failure in production is unactionable.
    expect(result.error?.issues[0]?.path).toEqual(["feeds", 0, "pollsToday"]);
  });
});
