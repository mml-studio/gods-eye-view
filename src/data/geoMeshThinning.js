/**
 * @module geoMeshThinning
 *
 * Bounded, spatially-stratified thinning of a national point set to what one
 * viewport can legibly draw.
 *
 * ── Why this file exists apart from its callers ─────────────────────────────
 * `irveMesh.js` worked this policy out for the charge-point layer and carries
 * the measurements that justify every rule in it — read that header first, it
 * is the argument. What is NOT charge-point-specific is the algorithm itself,
 * which only ever reads four numbers per row: a latitude, a longitude, a
 * WEIGHT to rank by, and a CATEGORY to be representative of. Schools have
 * exactly that shape (pupils, level) as charge points do (points de charge,
 * power band), so the second caller would have been a 277-line copy whose
 * divergence from the first nobody would notice until the two maps thinned
 * differently for no stated reason.
 *
 * So the policy lives here once, and `irveMesh.js` and `schoolsMesh.js` are
 * both thin adapters that name the tuple in their own domain and set their own
 * budgets. `irveMesh.js` keeps its full export surface and its own tests, which
 * is what proves this extraction changed nothing.
 *
 * ── The policy, in one paragraph ───────────────────────────────────────────
 * Bucket the view into a grid and give every occupied cell one dot before any
 * cell gets a second, so a sparse region reads as sparse-but-present rather
 * than as absent — which taking the biggest N nationally would make it. Each
 * cell is represented by the largest example of its MODAL category, not by its
 * largest member, because the largest member of a rural cell is an outlier and
 * a map built from outliers describes a country that does not exist. Leftover
 * budget is spent walking position order at a fixed stride, which samples the
 * mix that is actually there instead of re-sorting by size and undoing the
 * correction.
 *
 * ── What the caller must do with the result ────────────────────────────────
 * Report it. A thinned map that does not say it is thinned is a map claiming
 * the country holds `budget` things. `selectGeoMesh` returns both the count it
 * kept and the count it was given, and every caller prints both.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/**
 * A mesh row is a 4-tuple, not an object: `[lat, lon, weight, category]`.
 *
 * Tens of thousands of them travel to the browser in one document, and objects
 * with four keys apiece cost roughly 2.7× what tuples cost (measured on the
 * charge-point set: 2.4 MB against 0.9 MB). The index constants exist so no
 * caller has to remember the order.
 */
export const MESH_LAT = 0;
export const MESH_LON = 1;
export const MESH_WEIGHT = 2;
export const MESH_CATEGORY = 3;

/**
 * Default grid the view is bucketed into.
 *
 * 30 × 20 = 600 cells, deliberately BELOW every budget its callers use: when
 * cells outnumber the budget, only the highest-ranked cells win and the pick
 * silently becomes rank-based again — the exact failure this grid exists to
 * prevent. Keeping cells < budget guarantees every occupied cell is
 * represented before a single second dot is placed anywhere.
 */
export const MESH_COLS = 30;
export const MESH_ROWS = 20;

/**
 * ── THE WORLD LATTICE, AND WHY THE VIEW-RELATIVE GRID IS NOT ENOUGH ─────────
 *
 * The grid above is a fraction of the CURRENT BOX, so its cells slide with the
 * camera: pan one kilometre and every cell boundary moves one kilometre, the
 * buckets re-form around different sites, and a different site wins each cell.
 * Nothing in the world changed and the map redrew. That is G3 — *agréger en
 * espace monde, pas en espace écran* — and its test is exactly this one: pan
 * without changing altitude and watch the counters move.
 *
 * A caller can instead pass `lattice: { stepDeg }`, and then a cell is a fixed
 * square of the graticule — `floor(lat / step)`, `floor(lon / step)` — with no
 * reference to the box at all. The same site falls in the same cell in every
 * view that contains it, so panning slides the map under a stationary mesh.
 *
 * THE LADDER IS A QUADTREE, and that is what makes a tier change readable: a
 * caller's steps are powers of two of a degree, so every cell of a finer tier
 * is exactly inside one cell of the coarser tier. Changing tier SUBDIVIDES the
 * mesh; it never reshuffles it.
 *
 * WHAT A LATTICE CELL IS NOT: equal-area (C3). A step of 0.25° is 27.8 km tall
 * everywhere and 20.7 km wide at Perpignan against 17.5 km at Lille — a 15 %
 * spread across metropolitan France. Callers that draw a lattice have to say
 * so in their key; the alternative, a longitude step that widens with
 * latitude, would break the world lock this exists to provide.
 *
 * WITH A LATTICE THERE IS NO STRIDE FILL. The point of the stride was to spend
 * leftover budget on extra individual dots; a lattice pick reports a COMPLETE
 * AGGREGATE per cell instead, and a second dot in an already-counted cell
 * would be counted twice by anything reading those aggregates. One mark per
 * occupied cell, and the budget is spent by choosing the step.
 */

/** Coarsest and finest lattice steps a caller may ask for, in degrees. */
export const MESH_LATTICE_MIN_STEP_DEG = 1 / 4096;
export const MESH_LATTICE_MAX_STEP_DEG = 8;

/**
 * Resolve a latitude span against a caller's budget ladder.
 *
 * Latitude and not the larger of the two spans: on the app's 16:10 viewport
 * the longitude span runs about 2.4× the latitude one (measured — 9.53° lat
 * against 24.42° lon at 1 400 km), so the larger span is mostly a statement
 * about the window's aspect ratio. Latitude is the axis that answers "how far
 * out am I", and it is the one metropolitan France's 9.8° height is measured
 * against.
 *
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @param {ReadonlyArray<{maxLatSpanDeg:number, budget:number}>} tiers
 *   Ascending by `maxLatSpanDeg`; the last tier should be `Infinity`.
 * @returns {number}
 */
export function meshBudgetForSpan(latSpanDeg, tiers) {
  const ladder = Array.isArray(tiers) && tiers.length ? tiers : null;
  if (!ladder) return 0;
  const span = Number.isFinite(latSpanDeg) ? Math.max(0, latSpanDeg) : Infinity;
  for (const tier of ladder) {
    if (span <= tier.maxLatSpanDeg) return tier.budget;
  }
  return ladder.at(-1).budget;
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshRowInBox(row, box) {
  if (!box || !Array.isArray(row)) return false;
  const lat = row[MESH_LAT];
  const lon = row[MESH_LON];
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * Stable identity for a mesh row, matching the key the exact regime uses so a
 * selection can survive the handover between the two.
 */
export function meshRowId(row) {
  return `${Number(row[MESH_LAT]).toFixed(5)},${Number(row[MESH_LON]).toFixed(5)}`;
}

/**
 * Heaviest first, ties broken by position.
 *
 * The tie-break is not decoration — without it, two rows with the same weight
 * would swap places between frames as the array order shifted, and the map
 * would shimmer while standing still.
 */
export function byWeight(a, b) {
  const delta = (b[MESH_WEIGHT] || 0) - (a[MESH_WEIGHT] || 0);
  if (delta) return delta;
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
}

/** South-to-north, then west-to-east. The order the stride fill walks. */
export function byPosition(a, b) {
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
}

/**
 * The row that represents a cell: the largest example of the cell's most
 * common category.
 *
 * The bucket is assumed already sorted heaviest-first, so the first match is
 * the largest of the modal category. Ties between equally common categories go
 * to the LOWER category index, which is deterministic — callers are expected to
 * order their category ladders so that the low end is the one that over-claims
 * nothing (slower charging, smaller school).
 *
 * @param {Array<Array<number>>} bucket Rows in one cell, sorted by `byWeight`.
 * @returns {Array<number>}
 */
export function cellRepresentative(bucket) {
  const counts = [];
  for (const row of bucket) {
    const category = row[MESH_CATEGORY];
    counts[category] = (counts[category] || 0) + 1;
  }
  let modal = -1;
  let best = 0;
  for (let category = 0; category < counts.length; category += 1) {
    if ((counts[category] || 0) > best) {
      best = counts[category];
      modal = category;
    }
  }
  return bucket.find((row) => row[MESH_CATEGORY] === modal) || bucket[0];
}

/**
 * Bucket the rows inside a box into cells, either view-relative or world-locked.
 *
 * @param {Array<Array<number>>} rowsIn
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {{nCols:number, nRows:number, stepDeg:?number}} grid
 * @returns {{cells:Map<string|number, Array<Array<number>>>, inBox:number}}
 */
function bucketRows(rowsIn, box, { nCols, nRows, stepDeg }) {
  // A degenerate box would divide by zero; one cell is the honest answer for a
  // view with no extent rather than a NaN column index.
  const latSpan = box.north - box.south;
  const lonSpan = box.east - box.west;
  const cells = new Map();
  let inBox = 0;
  for (const row of rowsIn) {
    if (!meshRowInBox(row, box)) continue;
    inBox += 1;
    const key = stepDeg
      // World-locked: the cell is a square of the graticule and the box is not
      // in the expression at all, which is the whole property (G3).
      ? `${Math.floor(row[MESH_LAT] / stepDeg)}:${Math.floor(row[MESH_LON] / stepDeg)}`
      : (latSpan > 0
        ? Math.min(nRows - 1, Math.max(0, Math.floor(((row[MESH_LAT] - box.south) / latSpan) * nRows)))
        : 0) * nCols
        + (lonSpan > 0
          ? Math.min(nCols - 1, Math.max(0, Math.floor(((row[MESH_LON] - box.west) / lonSpan) * nCols)))
          : 0);
    const bucket = cells.get(key);
    if (bucket) bucket.push(row);
    else cells.set(key, [row]);
  }
  return { cells, inBox };
}

/**
 * Pick a bounded, spatially-spread subset of the rows inside a box.
 *
 * @param {Array<Array<number>>} rows National mesh tuples.
 * @param {object} options
 * @param {{south:number, west:number, north:number, east:number}} options.box
 * @param {number} options.budget Row cap. Callers resolve it from their own
 *   ladder via `meshBudgetForSpan` before calling.
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @param {{stepDeg:number}} [options.lattice] World-locked cells of `stepDeg`
 *   degrees instead of a fraction of the box. Doubles the step until the
 *   occupied cells fit the budget, so the pick can never silently degrade into
 *   "the biggest N cells". Turns off the stride fill and returns a complete
 *   aggregate per cell.
 * @returns {{picked:Array<Array<number>>, inBox:number, budget:number,
 *   thinned:boolean, cells:number, stepDeg:?number, coarsened:number,
 *   aggregates:?Array<{total:number, rows:number}>}}
 */
export function selectGeoMesh(rows, { box, budget, cols, rows: rowCount, lattice } = {}) {
  const rowsIn = Array.isArray(rows) ? rows : [];
  const empty = {
    picked: [], inBox: 0, budget: 0, thinned: false, cells: 0,
    stepDeg: null, coarsened: 0, aggregates: null,
  };
  if (!box) return empty;

  const cap = Math.max(0, Math.floor(Number.isFinite(budget) ? budget : 0));
  const nCols = Math.max(1, Math.floor(cols ?? MESH_COLS));
  const nRows = Math.max(1, Math.floor(rowCount ?? MESH_ROWS));

  const asked = Number(lattice?.stepDeg);
  let stepDeg = Number.isFinite(asked) && asked > 0
    ? Math.min(MESH_LATTICE_MAX_STEP_DEG, Math.max(MESH_LATTICE_MIN_STEP_DEG, asked))
    : null;

  let { cells, inBox } = bucketRows(rowsIn, box, { nCols, nRows, stepDeg });
  // MORE CELLS THAN BUDGET IS THE ONE FAILURE THE GRID EXISTS TO PREVENT: only
  // the highest-ranked cells would win and the pick would be rank-based again.
  // The view-relative grid rules it out by construction (600 cells, every
  // budget above it); a world lattice cannot, because the box is free to hold
  // any number of cells. So the step DOUBLES — staying on the quadtree, so the
  // coarser mesh is the finer one merged four cells at a time — until it fits.
  let coarsened = 0;
  while (stepDeg && cap > 0 && cells.size > cap && stepDeg < MESH_LATTICE_MAX_STEP_DEG) {
    stepDeg = Math.min(MESH_LATTICE_MAX_STEP_DEG, stepDeg * 2);
    coarsened += 1;
    ({ cells, inBox } = bucketRows(rowsIn, box, { nCols, nRows, stepDeg }));
  }

  if (!cap || !inBox) {
    return {
      ...empty, inBox, budget: cap, thinned: inBox > 0, cells: cells.size, stepDeg, coarsened,
    };
  }

  const cellBest = [];
  const rest = [];
  /** Aligned with `cellBest`: what the whole cell holds, not what its mark is. */
  const aggregates = [];
  for (const bucket of cells.values()) {
    bucket.sort(byWeight);
    const winner = cellRepresentative(bucket);
    cellBest.push(winner);
    if (stepDeg) {
      let total = 0;
      for (const row of bucket) total += Number(row[MESH_WEIGHT]) || 0;
      aggregates.push({ total, rows: bucket.length });
      continue;
    }
    for (const row of bucket) {
      if (row !== winner) rest.push(row);
    }
  }

  if (stepDeg) {
    // One mark per occupied cell, heaviest cell first so a view that somehow
    // still overflows keeps the most substantial cells. `byWeight` ranks the
    // MARKS; the cells are ranked by what they hold, which is the figure the
    // caller draws.
    const order = aggregates
      .map((aggregate, index) => index)
      .sort((a, b) => aggregates[b].total - aggregates[a].total
        || byWeight(cellBest[a], cellBest[b]));
    const kept = order.slice(0, cap);
    return {
      picked: kept.map((index) => cellBest[index]),
      aggregates: kept.map((index) => aggregates[index]),
      inBox,
      budget: cap,
      // A lattice pick is "thinned" whenever it stands for more rows than it
      // draws — which is nearly always, since a cell with four sites draws one
      // mark. The caller prints both numbers either way.
      thinned: kept.length < inBox,
      cells: cells.size,
      stepDeg,
      coarsened,
    };
  }
  // Cell winners are cut heaviest-first if there are somehow more cells than
  // budget, so an under-budget view still shows the most substantial ones.
  cellBest.sort(byWeight);
  const picked = cellBest.slice(0, cap);

  // Spend the rest by walking position order at a fixed stride: that samples
  // whatever category mix is actually in view, where re-sorting by size would
  // put back the over-representation the cell rule just removed.
  rest.sort(byPosition);
  const need = cap - picked.length;
  if (need > 0 && rest.length) {
    const taken = new Set();
    const stride = Math.max(1, Math.floor(rest.length / need));
    for (let i = 0; i < rest.length && picked.length < cap; i += stride) {
      taken.add(i);
      picked.push(rest[i]);
    }
    // The stride can undershoot on a short remainder; top up in order so the
    // budget is actually spent rather than silently left on the table.
    for (let i = 0; i < rest.length && picked.length < cap; i += 1) {
      if (taken.has(i)) continue;
      picked.push(rest[i]);
    }
  }
  return {
    picked,
    inBox,
    budget: cap,
    thinned: picked.length < inBox,
    cells: cells.size,
    stepDeg: null,
    coarsened: 0,
    aggregates: null,
  };
}
