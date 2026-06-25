import { createRepositories, openDatabase, type Repositories } from "@njt/db";
import { describe, expect, it } from "vitest";
import { generateSyntheticData } from "../src/seed/generate";

describe("generateSyntheticData", () => {
  it("produces a catalog, events, aggregates, official metrics, and alerts", () => {
    const repos: Repositories = createRepositories(openDatabase());
    const result = generateSyntheticData(repos, { days: 3, endDate: "2025-07-15", seed: 42, lineCount: 4 });

    expect(result.days).toBe(3);
    expect(result.events).toBeGreaterThan(0);

    // Catalog
    const version = repos.gtfs.currentVersion();
    expect(version).not.toBeNull();
    expect(repos.gtfs.routes(version!.versionId)).toHaveLength(4);

    // Aggregates exist for the seeded range and the system rolls up trips.
    const otp = repos.aggregates.getOtpDailyRows("system", "system", "all", "2025-07-13", "2025-07-15");
    expect(otp.length).toBe(3);
    expect(otp.every((r) => r.tripsOperated + r.tripsCancelled > 0)).toBe(true);

    // Connections were discovered at the shared hubs.
    expect(repos.aggregates.topConnectionTriples(5).length).toBeGreaterThan(0);

    // Official metrics come from the real CSV importer, not the seed.
    expect(repos.official.getAllForLine("Northeast Corridor Line")).toHaveLength(0);
    expect(repos.alerts.list({}).total).toBeGreaterThan(0);
    expect(repos.health.collectionStartDate()).toBe("2025-07-13");
  });
});
