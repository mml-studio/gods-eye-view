/**
 * ADEME DPE feed projection — the energy label of the building, and of its
 * neighbours.
 *
 * WHAT THIS SOURCE IS. Every *diagnostic de performance énergétique* issued in
 * France since July 2021, published by the ADEME. A DPE is compulsory for any
 * sale, so the register is close to a census of what has changed hands — and
 * because it is geocoded against the BAN, it answers a question no listing
 * does: not just "what is this flat's label" but "what are the labels of the
 * whole street".
 *
 * MEASURED against the live API on 2026-09-01:
 *   - dataset `dpe03existant` (id `meg-83tjwtg8dyz4vv7h1dqe`), **15,476,290
 *     rows**, **230 fields**, `access-control-allow-origin: *`, keyless
 *   - `GET /lines?geo_distance=2.3760,48.8300,300` → 200, `total: 2805`
 *     within 300 m of one Paris 13e point
 *   - each row carries `_geo_distance` in METRES and `_geopoint` as the string
 *     `"lat,lon"` — latitude first, the inverse of the `geo_distance` argument
 *     order, which is `lon,lat,radius`
 *
 * WHY A PROXY FOR SOMETHING THIS SMALL. Not for CORS, and not for size: three
 * rows are 1,613 bytes. It exists to pin the FIELD SELECTION. A `select` naming
 * a field the schema does not have returns HTTP 400 with an ODSQL-style error
 * rather than ignoring it, so the 230-field surface has to be pinned somewhere
 * a unit test can see it — and the browser should not carry a list of 230
 * French column names to discover that.
 *
 * WHAT THE PROJECTION REFUSES TO DO. It does not average labels into a
 * "neighbourhood grade". A DPE describes one dwelling's envelope and heating
 * system; the mean of a street's letters is not a property of the street. The
 * distribution is returned instead, and the reader draws their own conclusion.
 *
 * Dependency-free and side-effect-free. The `/api/dpe` proxy imports this.
 */

const DATASET = 'dpe03existant';
const API_ROOT = `https://data.ademe.fr/data-fair/api/v1/datasets/${DATASET}`;

/** Default search radius in metres. */
export const DPE_DEFAULT_RADIUS_M = 200;
/** Ceiling on the radius. */
export const DPE_MAX_RADIUS_M = 1000;
/** Ceiling on rows served in one answer. */
export const DPE_MAX_ENTRIES = 500;

/**
 * The fields the projection reads, and the only ones requested.
 *
 * Pinned as an exported constant because naming a field this dataset does not
 * publish is an HTTP 400, not a silently ignored column: an edition that
 * renamed one of these would take the whole layer down rather than degrade it.
 */
export const DPE_FIELDS = Object.freeze([
  'numero_dpe',
  'etiquette_dpe',
  'etiquette_ges',
  'adresse_ban',
  'identifiant_ban',
  // The pivot. The register names the BUILDING, not just the address point, and
  // that identifier is the same one the BD TOPO tiles carry — see `rnbPivot.js`
  // for what it buys and for the calibration behind the claim. Measured over
  // four boxes on 2026-09-07, `id_rnb` is present on 34.5 % (Ustaritz) to
  // 73.7 % (Paris 13e) of the rows a scan returns.
  'id_rnb',
  // How the register got it: `Reprise RNB` when the RNB matched the diagnostic
  // itself, `Logiciel` when the diagnostician's software declared it. Two
  // different claims about the same key, and the card is entitled to say which.
  'provenance_id_rnb',
  'annee_construction',
  'surface_habitable_logement',
  'cout_total_5_usages',
  'conso_5_usages_par_m2_ep',
  'emission_ges_5_usages_par_m2',
  'date_etablissement_dpe',
  '_geopoint',
]);

/** The seven labels, worst last, so a distribution keeps a meaningful order. */
export const DPE_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

/**
 * Coerce a query value to a number, treating ABSENT as absent.
 *
 * `URLSearchParams.get()` returns `null` for a missing parameter, `Number(null)`
 * is `0`, and `Number.isFinite(0)` is true — so a plain `Number()` turns "the
 * caller said nothing" into "the caller said zero", and every clamp below then
 * returns its MINIMUM instead of its default. Measured live: `GET /api/dpe`
 * with no `radius` scanned 50 m rather than the documented 200 m, and returned
 * `total: 0` for an address with 2,805 diagnostics around it. Same root cause
 * as the `addressPoint` guard in `vite.config.js`.
 *
 * @param {unknown} value
 * @returns {number|null} A finite number, or null when nothing usable was given.
 */
function requestedNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clamp a requested radius into the range this layer will serve.
 * @param {unknown} value @returns {number}
 */
export function clampDpeRadius(value) {
  const requested = requestedNumber(value);
  if (requested === null) return DPE_DEFAULT_RADIUS_M;
  return Math.min(DPE_MAX_RADIUS_M, Math.max(50, Math.round(requested)));
}

/**
 * Build the upstream URL for one address scan.
 *
 * `geo_distance` takes LONGITUDE, LATITUDE, RADIUS — while the `_geopoint` it
 * returns is latitude-first. The two orders are built and parsed in this one
 * module so the inconsistency is handled once.
 *
 * No `sort` is sent, and that is deliberate rather than an omission:
 * `sort=_geo_distance` is rejected with HTTP 400 — the distance is computed per
 * query, not stored — while `geo_distance` already returns rows nearest-first.
 * Asking for the sort explicitly takes the whole layer down.
 *
 * @param {{lon: number, lat: number, radiusM?: number, limit?: number}} query
 * @returns {string}
 */
export function buildDpeUrl({ lon, lat, radiusM, limit }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('dpe: lon/lat must be finite numbers');
  }
  const radius = clampDpeRadius(radiusM);
  const size = Math.min(DPE_MAX_ENTRIES, Math.max(1, Math.round(Number(limit) || 100)));
  const params = new URLSearchParams({
    size: String(size),
    geo_distance: `${lon},${lat},${radius}`,
    select: DPE_FIELDS.join(','),
  });
  return `${API_ROOT}/lines?${params}`;
}

/**
 * Parse the `"lat,lon"` geopoint string into a pair.
 * @param {unknown} value @returns {{lon: number, lat: number}|null}
 */
export function parseGeopoint(value) {
  const parts = String(value ?? '').split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lon, lat };
}

/** Normalise a label to one of the seven, or null. */
function label(value) {
  const letter = String(value ?? '').trim().toUpperCase();
  return DPE_LABELS.includes(letter) ? letter : null;
}

/** Coerce to a finite number, or null. Absent is not zero. */
function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Project the upstream page into the entries the client draws.
 *
 * `total` is the upstream's own count of matching diagnostics and is kept
 * separate from `entries.length`: the difference between "2,805 DPE within
 * 300 m" and "here are the 100 nearest" is the whole honesty of the layer.
 *
 * @param {object|null|undefined} payload Upstream `/lines` body.
 * @param {{radiusM: number}} context
 * @returns {{total: number|null, entries: Array<object>, truncated: boolean,
 *   distribution: Record<string, number>, medianCoutAnnuel: number|null}}
 */
export function projectDpe(payload, { radiusM } = {}) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const total = Number.isFinite(payload?.total) ? payload.total : null;
  const entries = [];
  const distribution = Object.fromEntries(DPE_LABELS.map((letter) => [letter, 0]));
  const costs = [];
  let withRnb = 0;
  for (const row of rows) {
    const point = parseGeopoint(row?._geopoint);
    const dpe = label(row?.etiquette_dpe);
    if (dpe) distribution[dpe] += 1;
    const cost = num(row?.cout_total_5_usages);
    if (cost !== null) costs.push(cost);
    const rnb = String(row?.id_rnb ?? '').trim() || null;
    if (rnb) withRnb += 1;
    entries.push({
      id: String(row?.numero_dpe ?? `dpe-${entries.length}`),
      etiquetteDpe: dpe,
      etiquetteGes: label(row?.etiquette_ges),
      address: row?.adresse_ban ?? null,
      banId: row?.identifiant_ban ?? null,
      // `rnb` is the name `buildingTheme.js` joins on. Carried on every entry,
      // graded or not: a diagnostic with no letter still belongs to a building
      // and still has to be counted against it.
      rnb,
      rnbSource: rnb ? (String(row?.provenance_id_rnb ?? '').trim() || null) : null,
      builtYear: num(row?.annee_construction),
      surfaceM2: num(row?.surface_habitable_logement),
      annualCostEur: cost,
      consoKwhM2: num(row?.conso_5_usages_par_m2_ep),
      gesKgM2: num(row?.emission_ges_5_usages_par_m2),
      issuedOn: row?.date_etablissement_dpe ?? null,
      lon: point ? point.lon : null,
      lat: point ? point.lat : null,
      distanceM: Number.isFinite(row?._geo_distance) ? Math.round(row._geo_distance) : null,
    });
  }
  costs.sort((a, b) => a - b);
  return {
    radiusM,
    total,
    entries,
    truncated: total !== null && total > entries.length,
    distribution,
    // Share of the served rows that name a building. It is the ceiling on what
    // the identity join can reach in this scan, and the layer prints it rather
    // than letting a thin edition look like a thin city.
    rnbCoverage: entries.length ? withRnb / entries.length : 0,
    medianCoutAnnuel: costs.length ? Math.round(costs[Math.floor((costs.length - 1) / 2)]) : null,
  };
}

// ---------------------------------------------------------------------------
// The cell regime — one mark per patch of ground, not per diagnostic
// ---------------------------------------------------------------------------
/**
 * Rows the ADEME will aggregate into geohash buckets in one answer.
 *
 * data-fair caps this at 100 and MEASURED headroom is wide: a 0.01° tile over
 * central Lyon returns 32 buckets and a 0.04° one 39. A tile that came back at
 * exactly the cap would be truncated, so the projection reports it rather than
 * drawing a partial grid as if it were whole.
 */
export const DPE_AGG_MAX_CELLS = 100;

/**
 * The letters this layer counts as *passoires thermiques*.
 *
 * F and G, which is the definition with a legal consequence attached to it —
 * the one cut of this register a reader acts on — and the same one
 * `dpeFrance.js` already makes on a building's card.
 */
export const DPE_POOR_LABELS = Object.freeze(['F', 'G']);

/**
 * Share of F and G across the WHOLE register, the anchor the cell colours are
 * read against.
 *
 * **9.75 %** — 967 510 F and 549 691 G out of 15 557 428 labelled diagnostics,
 * measured against `values_agg` on 2026-09-14.
 *
 * IT IS A PROPERTY OF THE REGISTER, NOT OF THE HOUSING STOCK, and the legend
 * has to say so. A DPE is compulsory on a sale or a new let, so the register
 * over-represents dwellings that changed hands recently and under-represents
 * the ones nobody has moved in thirty years. Calling this "9.75 % of French
 * housing" would be a different and unsupported claim.
 */
export const DPE_POOR_SHARE_NATIONAL = 9.75;

/**
 * Fewest diagnostics a cell needs before its share of F and G is published.
 *
 * Eight. Below that one diagnostic moves the share by more than twelve points,
 * which is wider than every class break below — the number would be carrying
 * the sampling, not the block. The cell still draws, at the size its count
 * earns it, in the layer's unknown colour.
 */
export const DPE_CELL_MIN_TOTAL = 8;

/**
 * URL for one geohash aggregation over a box.
 *
 * WHY `geo_agg` AND NOT PAGES OF ROWS. Measured on 2026-09-14 over one Lyon
 * viewport: the raw rows are ~12 000 diagnostics, twelve pages and about 10 MB;
 * the same ground as buckets is **5.3 KB in one request**, a factor of roughly
 * two thousand. Nothing is lost that the drawing could have used — at this
 * altitude a reader cannot resolve a building, and a mark per diagnostic is ink
 * spent on a distinction the screen cannot carry.
 *
 * THE CELL SIZE IS NOT ASKED FOR. data-fair picks the geohash precision from
 * the span of the bbox, and the bands in `scanRegime.js` are built around what
 * it picks: a 0.01° box is answered in precision 7 (107 × 152 m cells at this
 * latitude) and a 0.04° box in precision 6 (853 × 607 m). So the cells get
 * coarser as the camera climbs without either side negotiating a resolution.
 *
 * @param {{box: {south: number, west: number, north: number, east: number},
 *   poorOnly?: boolean}} query
 * @returns {string}
 */
export function buildDpeCellUrl({ box, poorOnly = false }) {
  if (!box || ![box.south, box.west, box.north, box.east].every(Number.isFinite)) {
    throw new Error('dpe: a cell scan needs a finite box');
  }
  const params = new URLSearchParams({
    bbox: `${box.west},${box.south},${box.east},${box.north}`,
    agg_size: String(DPE_AGG_MAX_CELLS),
    // Zero sample rows per bucket. Left at its default the same call answered
    // in 10.6 MB, because data-fair embeds a full 230-field row in every
    // bucket — the single most expensive default in this feed.
    size: '0',
  });
  if (poorOnly) params.set('qs', `etiquette_dpe:(${DPE_POOR_LABELS.join(' OR ')})`);
  return `${API_ROOT}/geo_agg?${params}`;
}

/**
 * Join one tile's two aggregations into cells.
 *
 * TWO CALLS, ONE PER NUMERATOR AND DENOMINATOR, joined on the geohash key. The
 * alternative — a nested aggregation returning the seven letters per bucket —
 * is not something this API exposes, and counting the letters ourselves would
 * mean downloading the rows this whole regime exists to avoid.
 *
 * `poorShare` IS NULL, NEVER ZERO, BELOW {@link DPE_CELL_MIN_TOTAL}. A cell
 * holding three diagnostics of which none is an F has not shown that its block
 * is sound; it has shown that three flats were sold there. The two are drawn
 * differently — see the layer's unknown class.
 *
 * @param {?object} totals Unfiltered `geo_agg` body.
 * @param {?object} poor The same call filtered to F and G.
 * @returns {{cells: Array<object>, total: number, poor: number, truncated: boolean}}
 */
export function projectDpeCells(totals, poor) {
  const poorByKey = new Map();
  for (const bucket of poor?.aggs || []) {
    if (bucket?.value) poorByKey.set(String(bucket.value), Number(bucket.total) || 0);
  }
  const cells = [];
  for (const bucket of totals?.aggs || []) {
    const key = String(bucket?.value ?? '');
    const total = Number(bucket?.total);
    const box = Array.isArray(bucket?.bbox) && bucket.bbox.length === 4 ? bucket.bbox : null;
    if (!key || !Number.isFinite(total) || total <= 0 || !box) continue;
    const centroid = bucket.centroid || bucket.center || null;
    const lon = Number(centroid?.lon);
    const lat = Number(centroid?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const poorCount = poorByKey.get(key) || 0;
    cells.push({
      key,
      lon: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      west: box[0],
      south: box[1],
      east: box[2],
      north: box[3],
      total,
      poor: poorCount,
      poorShare: total >= DPE_CELL_MIN_TOTAL
        ? Math.round((poorCount / total) * 1000) / 10
        : null,
    });
  }
  cells.sort((a, b) => b.total - a.total);
  return {
    cells,
    total: Number(totals?.total) || 0,
    poor: Number(poor?.total) || 0,
    // At the cap the grid is a subset of the ground and says so. Never seen in
    // eight measured city tiles; carried because a silent subset drawn as a
    // whole is the failure this layer has spent the most comments avoiding.
    truncated: (totals?.aggs || []).length >= DPE_AGG_MAX_CELLS,
  };
}

/**
 * Size classes for a DPE cell, per band, as counts of diagnostics.
 *
 * MEASURED over 445 precision-7 cells across eight city tiles — Lyon, Paris,
 * Bordeaux, Marseille, Nantes, Grenoble, Reims — on 2026-09-14: median 79
 * diagnostics per cell, ninth decile 225, densest 404. The coarse band's
 * breaks are those scaled by the ~32× area ratio between the two precisions.
 */
export const DPE_CELL_BREAKS = Object.freeze({
  fine: Object.freeze([15, 50, 100, 180, 300]),
  coarse: Object.freeze([100, 400, 1_000, 2_000, 4_000]),
});
