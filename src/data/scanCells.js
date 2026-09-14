/**
 * The mark a cell scan draws, and the arithmetic behind its size.
 *
 * WHAT A CELL IS HERE. Above {@link module:data/scanRegime.SCAN_CELL_MIN_ALTITUDE_M}
 * the DVF and DPE layers stop drawing one mark per sale or per diagnostic and
 * draw one mark per patch of ground. The patch comes from two different places
 * — the DVF proxy buckets rows it already holds, the ADEME's `geo_agg` returns
 * geohash buckets it computed itself — so this module takes the shape they
 * agree on and nothing else: a box, a centroid, and a count.
 *
 * THE DOCTRINE IS `filosofiCarreaux.js`'s, DELIBERATELY REUSED. That layer
 * already draws a national grid over this globe and already learned what a grid
 * may spend:
 *
 *   - A CELL IS A PLACE TO PUT A SYMBOL, NOT A TILE TO PAINT. Filling every
 *     cell edge to edge turns a city into an opaque quilt — no streets, no
 *     place names, no marker from any other layer. So the mark is one
 *     translucent DISC at the cell's centre, capped at {@link CELL_MAX_FILL}
 *     of the side, and the gap around it is the map.
 *   - COLOUR CARRIES THE INDICATOR, AREA CARRIES THE COUNT IT WAS COMPUTED ON.
 *     Sizing by the indicator is a category error: "5 800 €/m²" has no extent,
 *     and the eye reads extent as quantity. Sizing by the denominator gives
 *     every disc a meaning that adds up and leaves colour free.
 *   - FLAT, NEVER EXTRUDED. A camera looking down reads no height, and a field
 *     of prisms stands in front of the streets it describes.
 *
 * The numbers below are that layer's, measured there and cited rather than
 * re-derived. What is NOT shared is the geometry: `filosofiFeed.js` builds its
 * discs in EPSG:3035 because its cells are defined in it, while these cells
 * arrive already in WGS84 and are at most a few hundred metres across, where a
 * local cos(latitude) scaling is accurate to far under a pixel.
 *
 * Dependency-free and side-effect-free, so the proxy, the layers and
 * `node --test` share one definition of how big a disc is.
 *
 * @module data/scanCells
 */

/**
 * What marks an entity as a scan's own chrome rather than one of its subjects.
 *
 * It lives in this dependency-free module, not in `scanBoundary.js` where it is
 * used, so `addressScanLayer.js` can refuse to index a boundary without
 * importing a drawing module into the shell every layer is built on.
 */
export const SCAN_BOUNDARY_KIND = 'scan-boundary';

/**
 * The most of its own cell a disc may take, as a fraction of the SHORT side.
 *
 * 0.68, from `filosofiFeed.js`, where it is the ceiling that keeps the
 * carroyage from hiding the basemap: a disc at this fraction covers 36 % of its
 * cell and leaves the rest to the streets underneath. Stated against the short
 * side because the ADEME's geohash cells are not square — 107 × 152 m at
 * precision 7 — and a fraction of the LONG side would let a disc spill out of
 * its own cell sideways.
 */
export const CELL_MAX_FILL = 0.68;

/**
 * The smallest class, and it is a floor with a job: below about eight pixels a
 * disc has no size a viewer can compare, and two of them differing by half
 * their area read as two identical dots.
 */
export const CELL_MIN_FILL = 0.26;

/** Diameter of a disc covering the same ground as a square of the same side. */
export const CELL_DISC_DIAMETER = 2 / Math.sqrt(Math.PI);

/** Metres per degree of latitude, near enough anywhere France publishes. */
const M_PER_DEG_LAT = 110_540;
/** Metres per degree of longitude at the equator. */
const M_PER_DEG_LON = 111_320;

/**
 * The short side of a cell, in metres.
 * @param {{west: number, south: number, east: number, north: number}} cell
 * @returns {number}
 */
export function cellSideM(cell) {
  const lat = (cell.north + cell.south) / 2;
  const height = (cell.north - cell.south) * M_PER_DEG_LAT;
  const width = (cell.east - cell.west) * M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  return Math.max(1, Math.min(height, width));
}

/**
 * Which of six size classes a count falls in.
 *
 * SIX MEASURED CLASSES RATHER THAN A PROPORTION, for the reason
 * `filosofiFeed.js` gives: a strictly proportional disc is unreadable at both
 * ends of a skewed distribution at once, and these distributions are very
 * skewed — over 877 communes of cached DVF editions, half of all 150 m cells
 * hold four sales or fewer while the densest holds several hundred.
 *
 * @param {number} count
 * @param {ReadonlyArray<number>} breaks Five ascending edges.
 * @returns {number} 0 to `breaks.length`.
 */
export function cellBand(count, breaks) {
  if (!Number.isFinite(count) || count <= 0) return -1;
  let band = 0;
  for (const edge of breaks) {
    if (count < edge) break;
    band += 1;
  }
  return band;
}

/**
 * How much of its cell a count's disc fills.
 *
 * EVEN STEPS IN DIAMETER, NOT IN AREA. The classes are ordinal — "one class
 * up" — and an eye compares widths far better than areas; stepping the area
 * evenly would make the first jump nearly imperceptible, which is where most
 * of the country's cells sit.
 *
 * @param {number} count
 * @param {ReadonlyArray<number>} breaks
 * @returns {number} Fraction of the cell's short side; 0 for an empty cell.
 */
export function cellFill(count, breaks) {
  const band = cellBand(count, breaks);
  if (band < 0) return 0;
  const step = (CELL_MAX_FILL - CELL_MIN_FILL) / breaks.length;
  return CELL_MIN_FILL + (band * step);
}

/**
 * The radius, in metres, of the disc a cell draws for its count.
 * @param {object} cell A cell carrying its own box.
 * @param {number} count
 * @param {ReadonlyArray<number>} breaks
 * @returns {number} 0 when the cell draws nothing.
 */
export function cellDiscRadiusM(cell, count, breaks) {
  const fill = cellFill(count, breaks);
  if (fill <= 0) return 0;
  return (cellSideM(cell) * fill * CELL_DISC_DIAMETER) / 2;
}

/**
 * The outline of a disc, as `[lon, lat]` pairs.
 *
 * 32 segments: at the widest these layers draw, the chord error is under a
 * third of a pixel — and the count is the AREA, so a visibly polygonal disc
 * would also be a disc of the wrong size.
 *
 * @param {number} lon @param {number} lat @param {number} radiusM
 * @param {number} [segments]
 * @returns {Array<[number, number]>}
 */
export function discRing(lon, lat, radiusM, segments = 32) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180));
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push([lon + (dLon * Math.cos(angle)), lat + (dLat * Math.sin(angle))]);
  }
  return points;
}

/**
 * How far above its terrain sample a disc is laid, in metres.
 *
 * The ground is sampled at the cell's CENTRE, and a disc pinned to that height
 * on a hillside has its uphill half swallowed by the terrain it describes —
 * Fourvière is 130 m above the Saône inside a few hundred metres. So the
 * clearance scales with the disc's own radius, a fifth of it, which keeps any
 * disc whole on a slope up to 20 %. The floor stops the smallest symbols from
 * z-fighting the imagery they lie on. Both numbers are `filosofiFeed.js`'s.
 *
 * @param {number} radiusM
 * @returns {number}
 */
export function cellClearanceM(radiusM) {
  return Math.max(6, radiusM * 0.2);
}

/**
 * Bucket rows carrying `lon`/`lat` onto a metric grid inside a box.
 *
 * THE GRID IS ANCHORED ON THE GLOBE, NOT ON THE BOX, and that is what lets a
 * reader pan without the cells crawling: cell edges fall on absolute multiples
 * of the step, so the same sale lands in the same cell whatever box asked about
 * it. Anchoring on `box.south`/`box.west` would redraw every boundary each time
 * the snapped box moved one tile.
 *
 * @param {Array<object>} rows
 * @param {{south: number, west: number, north: number, east: number}} box
 * @param {number} cellM Target cell side, metres.
 * @returns {Array<{key: string, west: number, south: number, east: number,
 *   north: number, lon: number, lat: number, rows: Array<object>}>}
 */
export function bucketCells(rows, box, cellM) {
  const midLat = (box.north + box.south) / 2;
  const stepLat = cellM / M_PER_DEG_LAT;
  const stepLon = cellM / (M_PER_DEG_LON * Math.cos((midLat * Math.PI) / 180));
  const cells = new Map();
  for (const row of rows || []) {
    const lon = Number(row?.lon);
    const lat = Number(row?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) continue;
    const row0 = Math.floor(lat / stepLat);
    const col0 = Math.floor(lon / stepLon);
    const key = `${row0}:${col0}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        key,
        south: Number((row0 * stepLat).toFixed(7)),
        north: Number(((row0 + 1) * stepLat).toFixed(7)),
        west: Number((col0 * stepLon).toFixed(7)),
        east: Number(((col0 + 1) * stepLon).toFixed(7)),
        lon: 0,
        lat: 0,
        rows: [],
      };
      cells.set(key, cell);
    }
    cell.rows.push(row);
  }
  // The centroid of what is IN the cell, not the centre of the cell. A block
  // whose sales all sit on one street should put its disc on that street; the
  // geometric centre would stand it in the middle of a courtyard, and on a
  // 150 m grid that is most of a block away from anything it describes.
  for (const cell of cells.values()) {
    let lon = 0;
    let lat = 0;
    for (const row of cell.rows) { lon += row.lon; lat += row.lat; }
    cell.lon = lon / cell.rows.length;
    cell.lat = lat / cell.rows.length;
  }
  return [...cells.values()];
}

/**
 * The median of a numeric list, or null.
 * @param {Array<number>} values @returns {?number}
 */
export function medianOf(values) {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid] + sorted[mid + 1]) / 2;
}
