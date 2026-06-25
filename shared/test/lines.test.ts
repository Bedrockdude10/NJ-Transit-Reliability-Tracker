import { describe, expect, it } from "vitest";
import {
  RAIL_LINES,
  findLineById,
  findLineByName,
  lineHasAmtrakAttribution,
} from "../src/lines";

describe("rail line catalog", () => {
  it("has unique ids and route ids", () => {
    const ids = RAIL_LINES.map((l) => l.id);
    const routeIds = RAIL_LINES.map((l) => l.defaultRouteId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routeIds).size).toBe(routeIds.length);
  });

  it("looks up by id and name", () => {
    expect(findLineById("northeast-corridor")?.name).toBe("Northeast Corridor Line");
    expect(findLineByName("Raritan Valley Line")?.id).toBe("raritan-valley");
    expect(findLineById("does-not-exist")).toBeUndefined();
  });

  it("flags Amtrak attribution only for NEC and NJCL", () => {
    expect(lineHasAmtrakAttribution("Northeast Corridor Line")).toBe(true);
    expect(lineHasAmtrakAttribution("North Jersey Coast Line")).toBe(true);
    expect(lineHasAmtrakAttribution("Morris & Essex Line")).toBe(false);
    expect(lineHasAmtrakAttribution("Unknown Line")).toBe(false);
  });
});
