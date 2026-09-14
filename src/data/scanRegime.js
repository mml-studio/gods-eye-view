/**
 * When a point-centred French scan stops drawing points and starts drawing
 * cells, and the box it asks about when it does.
 *
 * WHY THIS EXISTS. `addressScanLayer.js` asks the register about a DISC around
 * the point the camera is looking at — 300 m for DVF, 200 m for the DPE. That
 * is the right question at street level and the wrong one from a thousand
 * metres up, where the disc covers a few percent of what is on screen and the
 * answer reads as a patch of confetti in the middle of an empty city. Measured
 * on the view that prompted this module: 0.28 km² scanned against ~5 km²
 * visible, 6 %.
 *
 * THE FIX IS NOT MORE DOTS. Widening the disc to the view was measured too —
 * ~3 000 mutations and ~12 000 diagnostics for one Lyon viewport, 10 MB of
 * rows — and it buys nothing a reader can use: three thousand € markers carry
 * the same information as four hundred, made unreadable. The question changes
 * with the altitude. "What did THIS building sell for" is only askable close
 * in; from higher up the question is "which block is dear", and that is a
 * different mark: one symbol per cell, not one per sale.
 *
 * So each layer runs two regimes and this module owns the switch:
 *
 *   - below {@link SCAN_CELL_MIN_ALTITUDE_M}, the disc, unchanged;
 *   - above it, a grid-aligned BOX, aggregated into cells by the proxy.
 *
 * THE BOX IS BUILT FROM THE LOOK-AT POINT, NEVER FROM `computeViewRectangle`.
 * That is the lesson `cadastreFeed.js` and `urbanismeGpu.js` both paid for: on
 * the oblique camera this globe opens with, the view rectangle runs to the
 * horizon, so a box cut from it is tens of kilometres deep and centred
 * nowhere near what the reader is looking at. Gating on ALTITUDE and centring
 * on the look-at point is the same arithmetic those two layers settled on.
 *
 * THE BOX SNAPS TO A GRID, and that is what makes panning free. A box derived
 * continuously from the camera moves with every settle, so every settle is a
 * new cache key and a new round trip. Snapped to the band's tile, a reader
 * panning a few streets asks the identical question and `runScan`'s own
 * signature guard answers it from what is already drawn.
 *
 * Dependency-free and side-effect-free — no Cesium, no DOM — so the layers,
 * the Vite proxy and `node --test` all read the same box arithmetic.
 *
 * @module data/scanRegime
 */

/**
 * Altitude at which a scan stops being about a place and starts being about an
 * area, in metres.
 *
 * 600 m, because that is where the disc stops covering the view. A nadir camera
 * at 600 m sees about 700 m of ground across the short side, which the 300 m
 * DVF disc fills; at 1 300 m — the altitude this globe lands on after a flight
 * to an address — it sees some 5 km² and the disc covers 6 % of it.
 *
 * Below this the reader can point at a building and expects one sale, one
 * diagnostic, one parcel. Above it they cannot resolve a building at all, and
 * a mark per sale is ink spent on a distinction the screen cannot carry.
 */
export const SCAN_CELL_MIN_ALTITUDE_M = 600;

/**
 * The two cell bands, and why there are exactly two.
 *
 * `tileDeg` is the unit the box is built and cached in; a box is always TWO
 * tiles on each axis, so a scan is always four tiles whatever the band. That
 * constant is deliberate: it fixes the upstream cost of a camera settle at
 * eight requests (two per tile for the DPE — see `dpeFeed.js`) instead of
 * letting it grow with altitude.
 *
 * `cellM` is the grid the DVF proxy buckets its own rows onto. It is not
 * arbitrary: it matches what the ADEME's `geo_agg` returns for a tile of this
 * span, MEASURED on 2026-09-14 at Lyon — a 0.01° bbox is answered in geohash
 * precision 7 (107 × 152 m cells) and a 0.04° bbox in precision 6 (853 × 607 m).
 * data-fair picks the precision from the box, so the two layers land on
 * comparable cells without either of them asking for a resolution.
 *
 * `maxAltitudeM` is the top of the band, not of the layer: the layer's own
 * ceiling (12 km for both) still applies above the last band.
 */
export const SCAN_BANDS = Object.freeze([
  Object.freeze({ id: 'fine', maxAltitudeM: 1_800, tileDeg: 0.01, cellM: 150 }),
  Object.freeze({ id: 'coarse', maxAltitudeM: Infinity, tileDeg: 0.04, cellM: 850 }),
]);

/** Every tile span a box may legitimately be built from. */
const TILE_DEGS = Object.freeze(SCAN_BANDS.map((band) => band.tileDeg));

/**
 * The band a camera altitude falls in, or null when the scan stays a disc.
 *
 * A PINNED scan is always a disc, whatever the altitude, and that is not an
 * exception to the rule — it is the rule. The pin exists because the reader
 * pointed at ONE address and asked about it; answering with a field of cells
 * would discard the only thing they said.
 *
 * @param {?{altitudeM: number, pinned?: boolean}} point
 * @returns {?{id: string, tileDeg: number, cellM: number}}
 */
export function scanBandFor(point) {
  if (point?.pinned) return null;
  const altitudeM = Number(point?.altitudeM);
  if (!Number.isFinite(altitudeM) || altitudeM < SCAN_CELL_MIN_ALTITUDE_M) return null;
  return SCAN_BANDS.find((band) => altitudeM < band.maxAltitudeM) || null;
}

/**
 * The grid-aligned box a cell scan asks about: two tiles on each axis, centred
 * on the tile line nearest the look-at point.
 *
 * ROUNDED TO THE NEAREST LINE RATHER THAN FLOORED, so the point sits within
 * half a tile of the middle of its own box. Flooring would put it in the
 * bottom-left quadrant and give the reader a box that reaches a tile and a half
 * north of what they are looking at and half a tile south of it.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} tileDeg
 * @returns {?{south: number, west: number, north: number, east: number}}
 */
export function scanCellBox(lat, lon, tileDeg) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Number.isFinite(tileDeg) || tileDeg <= 0) return null;
  const line = (value) => Number((Math.round(value / tileDeg) * tileDeg).toFixed(6));
  const latLine = line(lat);
  const lonLine = line(lon);
  const box = {
    south: Number((latLine - tileDeg).toFixed(6)),
    west: Number((lonLine - tileDeg).toFixed(6)),
    north: Number((latLine + tileDeg).toFixed(6)),
    east: Number((lonLine + tileDeg).toFixed(6)),
  };
  // A box straddling a pole or the dateline is not a small request, it is a
  // broken one — and neither register publishes anything there.
  if (box.south < -90 || box.north > 90 || box.west < -180 || box.east > 180) return null;
  return box;
}

/**
 * The four tiles a box is made of, in a stable order.
 *
 * Stable because the order is the cache's: two readers arriving at the same
 * block from different directions must queue on the same four keys, not on
 * eight.
 *
 * @param {{south: number, west: number, north: number, east: number}} box
 * @param {number} tileDeg
 * @returns {Array<{south: number, west: number, north: number, east: number}>}
 */
export function scanTiles(box, tileDeg) {
  const tiles = [];
  const steps = Math.max(1, Math.round((box.north - box.south) / tileDeg));
  const cols = Math.max(1, Math.round((box.east - box.west) / tileDeg));
  for (let row = 0; row < steps; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push({
        south: Number((box.south + (row * tileDeg)).toFixed(6)),
        west: Number((box.west + (col * tileDeg)).toFixed(6)),
        north: Number((box.south + ((row + 1) * tileDeg)).toFixed(6)),
        east: Number((box.west + ((col + 1) * tileDeg)).toFixed(6)),
      });
    }
  }
  return tiles;
}

/**
 * The query parameters for one scan: the box when the camera is high enough to
 * want cells, nothing when it is not.
 *
 * An ABSENT box IS the disc regime, server-side — the same contract
 * `urbanismeGpu.js` uses, and for the same reason: one route, one cache, and a
 * proxy that never has to be told which of two questions it is being asked.
 *
 * @param {?{lat: number, lon: number, altitudeM: number, pinned?: boolean}} point
 * @returns {Record<string, string>}
 */
export function scanCellParams(point) {
  const band = scanBandFor(point);
  if (!band) return {};
  const box = scanCellBox(point.lat, point.lon, band.tileDeg);
  if (!box) return {};
  return {
    south: box.south.toFixed(6),
    west: box.west.toFixed(6),
    north: box.north.toFixed(6),
    east: box.east.toFixed(6),
  };
}

/**
 * Read a box back off a request, and the band it was cut from.
 *
 * VALIDATED, NEVER CLAMPED. Everything here is reachable from a share link, so
 * a span that matches no band is a stranger's URL asking this server to
 * aggregate an arbitrary slab of France. There are two legal spans and a box
 * that is neither is refused, which drops the request back to the disc regime
 * rather than serving a question nobody designed.
 *
 * @param {URLSearchParams} search
 * @returns {?{box: object, band: object}}
 */
export function readScanCellBox(search) {
  const south = Number(search.get('south'));
  const west = Number(search.get('west'));
  const north = Number(search.get('north'));
  const east = Number(search.get('east'));
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south >= north || west >= east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  const spanLat = north - south;
  const spanLon = east - west;
  const tileDeg = TILE_DEGS.find((deg) => Math.abs(spanLat - (deg * 2)) < 1e-6
    && Math.abs(spanLon - (deg * 2)) < 1e-6);
  if (!tileDeg) return null;
  const band = SCAN_BANDS.find((entry) => entry.tileDeg === tileDeg) || null;
  if (!band) return null;
  return { box: { south, west, north, east }, band };
}

/**
 * A stable cache key for a box, at the precision the grid is snapped to.
 * @param {{south: number, west: number, north: number, east: number}} box
 * @returns {string}
 */
export function scanBoxKey(box) {
  return [box.south, box.west, box.north, box.east].map((v) => v.toFixed(4)).join(',');
}

/**
 * Points to ask "which commune is this?" about, to discover every commune a
 * box touches.
 *
 * WHY SAMPLING AND NOT A BOUNDARY QUERY. The commune a DVF edition is filed
 * under is the ARRONDISSEMENT for Paris, Lyon and Marseille — 75113, not 75056
 * — and the only French service that answers with that code is the BAN reverse
 * geocoder, which takes a point. `geo.api.gouv.fr`, which does serve contours,
 * answers 75056 for every Paris point and would send the proxy after an edition
 * that does not exist. So the box is probed rather than intersected.
 *
 * WHAT THAT COSTS IN HONESTY, stated rather than hidden: a commune whose
 * territory inside the box contains no sample point contributes nothing, and
 * its ground is then empty for the same reason a field is — no cell. The caller
 * publishes the sampled list so the gap is readable instead of inferred.
 *
 * Sampled at CELL CENTRES on an odd grid, so the middle of the box — the thing
 * the reader is actually looking at — is always probed.
 *
 * @param {{south: number, west: number, north: number, east: number}} box
 * @param {number} [maxPerAxis]
 * @returns {Array<{lat: number, lon: number}>}
 */
export function boxSamplePoints(box, maxPerAxis = 5) {
  const span = Math.max(box.north - box.south, box.east - box.west);
  // One probe per ~1.1 km, which is about the width of the smallest band's
  // tile, bounded at both ends: three is the fewest that puts a point in the
  // middle and one in each half, and `maxPerAxis` caps what a big box can spend
  // on reverse geocoding.
  const perAxis = Math.min(maxPerAxis, Math.max(3, Math.ceil(span / 0.01)));
  const odd = perAxis % 2 ? perAxis : perAxis + 1;
  const points = [];
  for (let row = 0; row < odd; row += 1) {
    for (let col = 0; col < odd; col += 1) {
      points.push({
        lat: box.south + (((row + 0.5) / odd) * (box.north - box.south)),
        lon: box.west + (((col + 0.5) / odd) * (box.east - box.west)),
      });
    }
  }
  return points;
}
