/**
 * @file Where two streets actually meet, derived from the road geometry the
 * traffic layer already fetched — no second Overpass request.
 *
 * The signal clock needed a junction and did not have one. It held a dot two
 * segments before the END OF ITS WAY, which is not the same place: a way's end
 * is a junction about 90 % of the time (measured, Paris 5e: 434 of 484 way
 * endpoints sit on a shared node), but "two segments before" put the stop in
 * the MIDDLE of the street. Dots froze mid-block while the ones already past
 * them drove straight through the crossing — which is exactly what a viewer
 * reported seeing: some dots stop, and the flow never stops.
 *
 * Overpass `out geom` gives coordinates, not node ids, so a junction is found
 * by coincidence: a vertex that appears in two or more ways. At Overpass's
 * fixed 7-decimal output this is an exact string match, not a proximity test —
 * two ways that merely pass near each other (a bridge over a street) do NOT
 * share a vertex, which is the correct answer for a grade separation.
 *
 * Measured on the same extract: 195 shared nodes out of 1 063, and 66
 * junctions sitting strictly INSIDE a way — crossings the end-of-way rule
 * could never see at all.
 *
 * @module data/roadJunctions
 */

/**
 * Coordinate key. Overpass emits 7 decimals, so this neither rounds away a
 * real distinction nor invents a match between two separate nodes.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function nodeKey(lat, lon) {
  return `${lat.toFixed(7)},${lon.toFixed(7)}`;
}

/**
 * Count how many ways use each vertex across a whole Overpass response.
 *
 * @param {Array<Object>} elements - Overpass elements (`out geom`).
 * @returns {Map<string,number>} Vertex key → number of ways touching it.
 */
export function countNodeUses(elements) {
  const uses = new Map();
  if (!Array.isArray(elements)) return uses;
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) continue;
    // A closed way (a roundabout, a square) repeats its first vertex as its
    // last. Counting it twice would promote every loop's seam to a junction.
    const geom = el.geometry;
    const closed = geom.length > 2
      && geom[0]?.lat === geom[geom.length - 1]?.lat
      && geom[0]?.lon === geom[geom.length - 1]?.lon;
    const end = closed ? geom.length - 1 : geom.length;
    for (let i = 0; i < end; i++) {
      const g = geom[i];
      if (!Number.isFinite(g?.lat) || !Number.isFinite(g?.lon)) continue;
      const k = nodeKey(g.lat, g.lon);
      uses.set(k, (uses.get(k) || 0) + 1);
    }
  }
  return uses;
}

/**
 * Flag which of a road's kept vertices are junctions.
 *
 * Takes the SUB-SAMPLED coordinate list, not the raw geometry: a dot only ever
 * stops at a vertex it actually travels through, so a junction dropped by
 * sub-sampling is one this road cannot stop at anyway. (In practice the two
 * lists are the same — the sub-sampler only engages past 80 vertices, and the
 * longest street in the measured extract has 36.)
 *
 * @param {number[][]} coords - `[lon, lat]` pairs, post sub-sampling.
 * @param {Map<string,number>} uses - From {@link countNodeUses}.
 * @returns {Uint8Array} 1 where the vertex is shared with another way.
 */
export function junctionFlags(coords, uses) {
  const flags = new Uint8Array(Array.isArray(coords) ? coords.length : 0);
  if (!uses || !Array.isArray(coords)) return flags;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (!Number.isFinite(c?.[0]) || !Number.isFinite(c?.[1])) continue;
    if ((uses.get(nodeKey(c[1], c[0])) || 0) >= 2) flags[i] = 1;
  }
  return flags;
}
