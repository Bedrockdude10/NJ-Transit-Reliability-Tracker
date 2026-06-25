import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows } from "../src/csv";

describe("parseCsvRows", () => {
  it("handles quotes, embedded commas/newlines, escaped quotes, and a BOM", () => {
    const text = '﻿a,b\r\n"x,y","line1\nline2"\r\n"he said ""hi""",z\n';
    expect(parseCsvRows(text)).toEqual([
      ["a", "b"],
      ["x,y", "line1\nline2"],
      ['he said "hi"', "z"],
    ]);
  });

  it("handles a final line without a trailing newline", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsv", () => {
  it("maps rows to objects keyed by the header and skips blank lines", () => {
    const rows = parseCsv("route_id,route_long_name\n\nNE,Northeast Corridor\n");
    expect(rows).toEqual([{ route_id: "NE", route_long_name: "Northeast Corridor" }]);
  });
});
