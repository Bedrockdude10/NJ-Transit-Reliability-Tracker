/** Pure map geometry for `SystemMap`. No React Native imports, so it is testable. */

export interface Pt {
  x: number;
  y: number;
}

/** Content is drawn as `translate(tx ty) scale(scale)`. */
export interface ViewBox {
  scale: number;
  tx: number;
  ty: number;
}

export const MAP_MIN_SCALE = 1;
export const MAP_MAX_SCALE = 8;

/** `[lon, lat]`, matching `NJ_STATE_OUTLINE`'s ordering. */
export type LonLat = readonly [number, number];

export interface ProjectableStation {
  stopId: string;
  lat: number;
  lon: number;
}

export interface Projection {
  project: (lat: number, lon: number) => Pt;
  coord: Map<string, Pt>;
  outlineD: string;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Keeps scaled content covering the viewport; locks to origin at 1×. */
export function clampView(v: ViewBox, w: number, h: number): ViewBox {
  const scale = Math.max(MAP_MIN_SCALE, Math.min(MAP_MAX_SCALE, v.scale));
  if (scale <= 1.0001) return { scale: 1, tx: 0, ty: 0 };
  return {
    scale,
    tx: Math.min(0, Math.max(w * (1 - scale), v.tx)),
    ty: Math.min(0, Math.max(h * (1 - scale), v.ty)),
  };
}

/** `focal` is in screen space and stays fixed. */
export function applyZoom(v: ViewBox, focal: Pt, factor: number, w: number, h: number): ViewBox {
  const scale = Math.max(MAP_MIN_SCALE, Math.min(MAP_MAX_SCALE, v.scale * factor));
  const baseX = (focal.x - v.tx) / v.scale;
  const baseY = (focal.y - v.ty) / v.scale;
  return clampView({ scale, tx: focal.x - baseX * scale, ty: focal.y - baseY * scale }, w, h);
}

/**
 * Fits the union of station coordinates and the state outline, with a
 * cosine-latitude correction so the map isn't stretched horizontally.
 */
export function buildProjection(
  stations: readonly ProjectableStation[],
  outline: readonly LonLat[],
  width: number,
  height: number,
  pad = 14,
): Projection {
  const lats = [...stations.map((s) => s.lat), ...outline.map(([, lat]) => lat)];
  const lons = [...stations.map((s) => s.lon), ...outline.map(([lon]) => lon)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const project = (lat: number, lon: number): Pt => ({
    x: offX + (lon - minLon) * k * scale,
    y: offY + (maxLat - lat) * scale,
  });

  const coord = new Map(stations.map((s) => [s.stopId, project(s.lat, s.lon)]));
  const outlineD =
    outline
      .map(([lon, lat], i) => {
        const p = project(lat, lon);
        return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  return { project, coord, outlineD };
}
