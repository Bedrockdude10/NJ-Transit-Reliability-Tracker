import type { ServiceAlert } from "@njt/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type Repositories } from "../src/index";

function alert(overrides: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    alertId: "A1",
    affectedRoutes: ["NE"],
    affectedStops: ["S1"],
    headerText: "Delays on the NEC",
    descriptionText: "Signal trouble near Newark.",
    effectType: "delay",
    activeFrom: 1_700_000_000,
    activeTo: null,
    ingestedAtMs: Date.UTC(2025, 6, 15, 12, 0, 0),
    ...overrides,
  };
}

describe("ServiceAlertRepository", () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase());
  });

  it("filters the alert log by affected route via json_each", () => {
    repos.alerts.upsert(alert());
    expect(repos.alerts.list({ route: "NE" }).total).toBe(1);
    expect(repos.alerts.list({ route: "NC" }).total).toBe(0);
  });

  it("keeps first_seen and a single row when an alert is re-ingested", () => {
    repos.alerts.upsert(alert({ ingestedAtMs: 1000 }));
    repos.alerts.upsert(alert({ ingestedAtMs: 5000, headerText: "Updated" }));
    const { alerts, total } = repos.alerts.list({});
    expect(total).toBe(1);
    expect(alerts[0]?.ingestedAtMs).toBe(1000); // first_seen preserved
    expect(alerts[0]?.headerText).toBe("Updated"); // latest text wins
  });

  it("paginates", () => {
    for (let i = 0; i < 5; i++) {
      repos.alerts.upsert(alert({ alertId: `A${i}`, ingestedAtMs: 1000 + i }));
    }
    const page = repos.alerts.list({ limit: 2, offset: 0 });
    expect(page.total).toBe(5);
    expect(page.alerts).toHaveLength(2);
    expect(page.alerts[0]?.alertId).toBe("A4"); // newest first
  });

  it("counts alert frequency per route and effect", () => {
    repos.alerts.upsert(alert({ alertId: "A1", affectedRoutes: ["NE", "NC"], effectType: "delay" }));
    repos.alerts.upsert(alert({ alertId: "A2", affectedRoutes: ["NE"], effectType: "detour" }));
    const freq = repos.alerts.frequency(0, Date.now() + 1_000_000);
    const necDelay = freq.find((f) => f.route === "NE" && f.effectType === "delay");
    const ncDelay = freq.find((f) => f.route === "NC" && f.effectType === "delay");
    expect(necDelay?.count).toBe(1);
    expect(ncDelay?.count).toBe(1);
    expect(freq.find((f) => f.route === "NE" && f.effectType === "detour")?.count).toBe(1);
  });
});
