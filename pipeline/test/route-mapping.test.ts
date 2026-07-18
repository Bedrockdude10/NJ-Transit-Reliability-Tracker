import { describe, expect, it } from "vitest";
import { mapRailRoutes, RAIL_ROUTE_TYPES, SHORT_NAME_TO_LINE_ID } from "../src/gtfs-static/route-mapping";

/** Minimal routes.txt row builder; only the fields mapRailRoutes reads. */
function row(o: Partial<Record<string, string>>): Record<string, string> {
  return { route_id: "", route_type: "2", route_short_name: "", route_long_name: "", route_color: "", ...o } as Record<string, string>;
}

describe("mapRailRoutes", () => {
  it("maps a short name to its canonical catalog line", () => {
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "100", route_short_name: "NEC", route_color: "EF3E42" }),
    ]);
    expect(realToCanonical.get("100")).toBe("NE"); // defaultRouteId, not line id
    const rec = canonicalRoutes.get("NE");
    expect(rec).toEqual({ routeId: "NE", lineName: "Northeast Corridor Line", color: "EF3E42", mode: "rail" });
  });

  it("accepts both rail route_type 2 and 113", () => {
    expect([...RAIL_ROUTE_TYPES]).toEqual(expect.arrayContaining(["2", "113"]));
    const { realToCanonical } = mapRailRoutes([
      row({ route_id: "1", route_short_name: "NEC", route_type: "2" }),
      row({ route_id: "2", route_short_name: "ACRL", route_type: "113" }),
    ]);
    expect(realToCanonical.get("1")).toBe("NE");
    expect(realToCanonical.get("2")).toBe("AC");
  });

  it("excludes light rail (route_type 0) and other non-rail types", () => {
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "L1", route_short_name: "NEC", route_type: "0" }),
      row({ route_id: "B1", route_short_name: "NEC", route_type: "3" }),
    ]);
    expect(canonicalRoutes.size).toBe(0);
    expect(realToCanonical.size).toBe(0);
  });

  it("falls back to the long name when the short name is unknown", () => {
    const { realToCanonical } = mapRailRoutes([
      row({ route_id: "G1", route_short_name: "ZZZ", route_long_name: "Gladstone Branch" }),
    ]);
    expect(realToCanonical.get("G1")).toBe("GL");
  });

  it("prefers the short-name mapping over the long-name fallback", () => {
    // Short name says NEC, long name says Gladstone: short wins.
    const { realToCanonical } = mapRailRoutes([
      row({ route_id: "X", route_short_name: "NEC", route_long_name: "Gladstone Branch" }),
    ]);
    expect(realToCanonical.get("X")).toBe("NE");
  });

  it("skips rows without a route id or with no catalog match", () => {
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "", route_short_name: "NEC" }),
      row({ route_id: "U1", route_short_name: "ZZZ", route_long_name: "Not A Real Line" }),
    ]);
    expect(canonicalRoutes.size).toBe(0);
    expect(realToCanonical.size).toBe(0);
  });

  it("collapses NJCL and NJCLL variants into one North Jersey Coast canonical route", () => {
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "10", route_short_name: "NJCL", route_color: "00A94F" }),
      row({ route_id: "11", route_short_name: "NJCLL", route_color: "IGNORED" }),
    ]);
    expect(realToCanonical.get("10")).toBe("NC");
    expect(realToCanonical.get("11")).toBe("NC");
    // Deduped: single canonical route, colour from the first row seen.
    expect(canonicalRoutes.size).toBe(1);
    expect(canonicalRoutes.get("NC")?.color).toBe("00A94F");
  });

  it("collapses Main and Bergen short names into main-bergen", () => {
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "20", route_short_name: "MAIN" }),
      row({ route_id: "21", route_short_name: "BERG" }),
      row({ route_id: "22", route_short_name: "MNBN" }),
    ]);
    expect(realToCanonical.get("20")).toBe("MN");
    expect(realToCanonical.get("21")).toBe("MN");
    expect(realToCanonical.get("22")).toBe("MN");
    expect(canonicalRoutes.size).toBe(1);
    expect(canonicalRoutes.get("MN")?.lineName).toBe("Main/Bergen County Line");
  });

  it("keeps Port Jervis (MNBNP) as its own canonical line, distinct from main-bergen", () => {
    // The catalog treats the Mobility Database's MNBNP as Port Jervis.
    expect(SHORT_NAME_TO_LINE_ID.MNBNP).toBe("port-jervis");
    const { canonicalRoutes, realToCanonical } = mapRailRoutes([
      row({ route_id: "30", route_short_name: "MNBN" }),
      row({ route_id: "31", route_short_name: "MNBNP" }),
    ]);
    expect(realToCanonical.get("30")).toBe("MN");
    expect(realToCanonical.get("31")).toBe("PJ");
    expect(canonicalRoutes.size).toBe(2);
  });

  it("normalizes an empty route_color to null", () => {
    const { canonicalRoutes } = mapRailRoutes([
      row({ route_id: "40", route_short_name: "NEC", route_color: "" }),
    ]);
    expect(canonicalRoutes.get("NE")?.color).toBeNull();
  });
});
