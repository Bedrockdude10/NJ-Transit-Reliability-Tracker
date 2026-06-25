/**
 * A coarse New Jersey state boundary, as `[lon, lat]` pairs (GeoJSON order),
 * traced clockwise from the NW corner. Used purely as a recognizable backdrop
 * behind the rail network on the system map — it is a simplified silhouette,
 * not survey-accurate. The rail network extends slightly beyond the state (NY
 * Penn, Philadelphia 30th St, Port Jervis), so the map fits the union of this
 * outline and the station coordinates.
 */
export const NJ_STATE_OUTLINE: readonly (readonly [number, number])[] = [
  [-74.695, 41.357], // High Point (NW corner)
  [-73.902, 41.09], // NY border meets the Hudson
  [-73.894, 40.997], // Palisades
  [-73.96, 40.83], // along the Hudson
  [-74.024, 40.703], // Jersey City / NY Harbor
  [-74.058, 40.642], // Bayonne
  [-74.197, 40.49], // Raritan Bay / Perth Amboy
  [-73.98, 40.47], // Sandy Hook
  [-74.005, 40.22], // Asbury Park
  [-74.077, 39.76], // Barnegat
  [-74.418, 39.36], // Atlantic City
  [-74.906, 38.928], // Cape May (southern tip)
  [-75.06, 39.193], // Delaware Bay
  [-75.467, 39.47], // Salem
  [-75.53, 39.64], // lower Delaware River
  [-75.413, 39.8], // near Wilmington / DE border
  [-75.135, 39.952], // Camden / Philadelphia
  [-74.945, 40.218], // Trenton
  [-74.948, 40.37], // Lambertville
  [-75.19, 40.69], // Phillipsburg
  [-75.13, 40.97], // Delaware Water Gap
  [-74.695, 41.357], // back to High Point (closes the ring)
] as const;
