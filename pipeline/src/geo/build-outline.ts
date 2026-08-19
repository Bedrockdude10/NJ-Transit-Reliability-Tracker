import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regenerate `shared/src/geo.ts` from a NJ GeoJSON. Drop a `nj.geojson`
 * (a Polygon/MultiPolygon Feature) into ./data and run `npm run build:geo`.
 * Good sources: glynnbird/usstatesgeojson, or US Census cartographic boundaries.
 */
const dataDir = process.env.NJT_GEOJSON ?? join("data", "nj.geojson");
const TARGET_POINTS = 130;

if (!existsSync(dataDir)) {
  console.error(`No GeoJSON at ${dataDir}. Download a NJ boundary and place it there.`);
  process.exit(1);
}

const geo = JSON.parse(readFileSync(dataDir, "utf8")) as {
  type?: string;
  geometry?: { type: string; coordinates: unknown };
  coordinates?: unknown;
};
const type = geo.geometry?.type ?? geo.type;
const coords = (geo.geometry?.coordinates ?? geo.coordinates) as number[][][] | number[][][][];

// Largest ring across Polygon / MultiPolygon.
const rings: number[][][] = type === "MultiPolygon" ? (coords as number[][][][]).flat() : (coords as number[][][]);
const ring = rings.reduce((a, b) => (b.length > a.length ? b : a), [] as number[][]);

const step = Math.max(1, Math.round(ring.length / TARGET_POINTS));
const pts: [number, number][] = [];
for (let i = 0; i < ring.length; i += step) {
  const [lon, lat] = ring[i] as [number, number];
  pts.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
}
const first = pts[0];
const last = pts[pts.length - 1];
if (first === undefined || last === undefined) {
  console.error("The GeoJSON ring contains no points — nothing to write.");
  process.exit(1);
}
if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);

const body = pts.map((p) => `  [${p[0]}, ${p[1]}],`).join("\n");
const file = `/**
 * New Jersey state boundary as \`[lon, lat]\` pairs (GeoJSON order), used as the
 * backdrop behind the rail network on the system map. Generated from a NJ
 * GeoJSON and simplified to ~${pts.length} points. Regenerate via \`npm run build:geo\`.
 */
export const NJ_STATE_OUTLINE: readonly (readonly [number, number])[] = [
${body}
];
`;
writeFileSync(join("shared", "src", "geo.ts"), file);
console.log(`Wrote shared/src/geo.ts with ${pts.length} points (from ${ring.length}-point ring).`);
