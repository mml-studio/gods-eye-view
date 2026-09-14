/**
 * @module irveMesh
 *
 * Pure selection policy for the middle regime of the charge-point layer: the
 * zooms between "all of France" and "one city", where the honest answer is
 * neither 96 département prisms nor 39 859 overlapping dots.
 *
 * IT IS A CARROYAGE NOW, NOT A SAMPLE. It began as a thinned sample of real
 * positions, and the section below is that argument — every measurement in it
 * still holds and still decides which site represents a cell. What changed on
 * 2026-09-10 is where the cells come from and what a mark reports: they are
 * squares of the graticule rather than fractions of the viewport, and each
 * mark carries its cell's COMPLETE charge-point total instead of standing for
 * an unstated number of neighbours. See « THE LATTICE » below the imports.
 *
 * ── The problem this exists to solve ────────────────────────────────────────
 * The register puts 231 079 charge points on 39 859 distinct coordinates.
 * Drawn all at once over a région that is a solid smear; drawn not at all,
 * the question "where actually ARE they" cannot be asked until you are over a
 * single city. What a reader wants at that scale is the MAILLAGE — the shape
 * of the network, its corridors and its holes — which survives thinning
 * perfectly well, as long as the thinning is spatial rather than by rank.
 *
 * ── Why a grid, and not "the biggest N" ─────────────────────────────────────
 * Ranking globally and taking the top N is the obvious thinning and the wrong
 * one: the top 900 sites nationally are almost all in the same dozen
 * conurbations, so the map would show France as a handful of bright clusters
 * surrounded by an empty country that is not in fact empty. The Massif
 * Central would vanish, and its emptiness is a real finding that deserves to
 * be visible as sparse-but-present rather than as absent.
 *
 * So the pick is stratified: bucket the view into a grid and give every
 * occupied cell one dot before any cell gets a second. A cell with one
 * 2-point car park keeps its dot; a cell with four hundred does not get four
 * hundred.
 *
 * ── Which site represents its cell, and why not the largest ─────────────────
 * The obvious cell winner is the biggest site in it, and that one is a lie by
 * picture. Measured over France at 900 km: taking the largest draws **46.2%
 * of the dots as high-power DC when 12.2% of the sites in view are** — the
 * largest site in a rural cell is almost always the motorway HPC bank, so a
 * map built that way says France runs on 300 kW chargers when it runs on
 * 22 kW ones.
 *
 * The cell is therefore represented by its MODAL band — the kind of charging
 * most common in that cell — at the largest example of it. Every dot is still
 * a real site at its real position with its real published band; only the
 * choice of which real site stands for its neighbours changes, and choosing
 * the typical one over the biggest one is the less biased choice. Measured
 * again: 8.7% high-power against 12.2% true, and the same correction holds at
 * région scale (12.7% against 14.8%).
 *
 * Leftover budget used to be spent by walking the remaining sites in position
 * order at a fixed stride, which sampled whatever mix was actually there
 * instead of re-sorting by size and undoing the correction. With a lattice
 * there is no leftover to spend: one mark per occupied cell, and the budget is
 * spent by choosing the STEP. The stride survives on the no-lattice path,
 * which `schoolsMesh.js` still uses.
 *
 * A residual bias survives and is worth naming: `normale` comes out around
 * 46% against 36% true, because the most common band wins the most cells.
 * That errs toward the most common kind of charging rather than the rarest,
 * which is the direction a sample should err in. It biases the COLOUR of a
 * mark only — the count a mark reports is its cell's complete total, so the
 * charge points on screen are not a sample of anything.
 *
 * This is `distributeCctvCards` from `cctvLod.js`, transposed from screen
 * space to geographic space — same shape, same guarantees, same deterministic
 * tie-break — because the CCTV ambient ring solves exactly this problem
 * (bounded budget, no clumping, stable under small camera moves) and had
 * already been through the field testing.
 *
 * ── Where the algorithm now lives ───────────────────────────────────────────
 * In `geoMeshThinning.js`, unchanged. The measurements above are what justify
 * it, and they are charge-point measurements, so the argument stays here; the
 * code moved out when the schools layer arrived needing the identical policy
 * over `[lat, lon, pupils, level]` instead of `[lat, lon, pdc, band]`. This
 * file is now the charge-point ADAPTER: it names the tuple, sets the budgets,
 * and re-exports the surface its tests and callers already use. Those tests
 * are unchanged, and their staying green is what proves the move was faithful.
 *
 * ── What the caller must do with the result ────────────────────────────────
 * Report it, in the unit it is in. A thinned map that does not say it is
 * thinned is a map claiming France has 900 charge points — and a map that
 * calls its lattice cells "sites" is answering a second question with the
 * first one's word. `selectIrveMesh` returns the marks it drew, the rows it
 * drew them from and the STEP it used, and the layer prints all three.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser and under `node --test`.
 */

import {
  MESH_CATEGORY,
  MESH_COLS,
  MESH_LAT,
  MESH_LON,
  MESH_ROWS,
  MESH_WEIGHT,
  cellRepresentative,
  meshBudgetForSpan,
  meshRowId,
  meshRowInBox,
  selectGeoMesh,
} from './geoMeshThinning.js';

/**
 * ── THE LATTICE, AND WHAT IT REPLACED ──────────────────────────────────────
 *
 * Everything above describes a pick whose cells were a fraction of the CURRENT
 * BOX. That made the maillage a function of where the camera happened to be:
 * pan a kilometre and every cell boundary moved a kilometre, so a different
 * site won each cell and the mesh redrew while the country stood still. G3
 * names that defect — *agréger en espace monde, pas en espace écran* — and its
 * test is a pan at constant altitude.
 *
 * MEASURED, on the register of 2026-09-10, over a France-wide view panned by
 * 0.05° — about 5 km, an ordinary drag:
 *
 *   view-relative grid   1 100 marks → 1 100 marks, **179 the same** (16.3 %)
 *   world lattice        1 057 marks → 1 055 marks, **1 050 the same** (99.3 %)
 *
 * Nine hundred marks used to move because the camera did. The seven that move
 * now are the ones that entered or left the box, which is the only reason a
 * mark on a map should ever appear or vanish.
 *
 * The cells are now squares of the graticule, at a step frozen per zoom tier,
 * and `geoMeshThinning.js` holds the mechanism. What belongs here is the
 * CALIBRATION, measured on the register itself (40 028 sites, 220 666 charge
 * points, fetched 2026-09-10) over seven real view boxes:
 *
 *                            budget   0.25°   0.0625°   0.015625°
 *   France entière (lat 8°)    1100  ▸ 1057     7 496      16 995
 *   Grande région   (lat 4°)   1100  ▸  542     3 859       7 921
 *   Région          (lat 2°)   1600     152   ▸ 1 017       1 909
 *   Aire urbaine  (lat 0.8°)   2200      28       197     ▸   502
 *   Bordeaux      (lat 0.5°)   2200      17        95     ▸   319
 *   Paris         (lat 0.5°)   2200      15       163     ▸ 1 144
 *   Ville         (lat 0.2°)   2200       5        36     ▸   347
 *
 * The marked column is the tier's step. Every occupied-cell count sits under
 * its budget, which is the property that keeps the pick from silently becoming
 * "the biggest N cells" — and the worst case, France at 0.25°, lands at 1 057
 * against 1 100 with 43 cells of headroom. Past that the step doubles itself
 * rather than overflowing.
 *
 * THE TABLE IS THE FULL BUDGET, AND THE PROFILE CAN HALVE IT. The layer runs
 * its budget through `profileCountBudget` before asking, so a machine on the
 * light profile asks for 660 rather than 1 100 — and France at 0.25° then does
 * not fit, and the step doubles itself to 0.5° (55 × 38 km cells). Measured in
 * a SwiftShader browser: `236 cellules pour 30 641 sites en vue · maille 0.5°`.
 * That is the mechanism working, not failing, and the layer's row prints the
 * step it actually used rather than the one this table publishes.
 *
 * THE STEPS ARE POWERS OF TWO OF A DEGREE (1/4, 1/16, 1/64), so the three
 * tiers are one quadtree: a tier change merges or splits four cells into one
 * and the mesh subdivides in place instead of reshuffling.
 *
 * WHAT A CELL MEASURES, IN KILOMETRES, AND WHERE IT DOES NOT (C3). A degree of
 * latitude is 111.2 km everywhere; a degree of longitude is not. Metropolitan
 * France spans 42.3°N to 51.1°N, so a cell is:
 *
 *   0.25°     27.8 km tall · 20.6 km wide at Perpignan, 17.5 km at Lille
 *   0.0625°    6.9 km tall ·  5.1 km / 4.4 km
 *   0.015625°  1.7 km tall ·  1.3 km / 1.1 km
 *
 * — a 15 % east-west spread over the country, which the layer's key declares
 * rather than hides. A longitude step that widened with latitude would even
 * the cells out and destroy the world lock this exists to provide.
 */

/**
 * Lattice step by view latitude span, in degrees. Same ladder shape as
 * {@link IRVE_MESH_BUDGETS} and deliberately the same boundaries, so a tier
 * change moves the budget and the mesh together rather than at two altitudes.
 */
export const IRVE_MESH_LATTICE = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, stepDeg: 1 / 64 }),
  Object.freeze({ maxLatSpanDeg: 2.5, stepDeg: 1 / 16 }),
  Object.freeze({ maxLatSpanDeg: Infinity, stepDeg: 1 / 4 }),
]);

/**
 * Lattice step for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function irveMeshStepDeg(latSpanDeg) {
  const span = Number.isFinite(latSpanDeg) ? Math.max(0, latSpanDeg) : Infinity;
  for (const tier of IRVE_MESH_LATTICE) {
    if (span <= tier.maxLatSpanDeg) return tier.stepDeg;
  }
  return IRVE_MESH_LATTICE.at(-1).stepDeg;
}

/**
 * A lattice cell's size where it is drawn, in kilometres.
 *
 * The width is a function of latitude and the height is not, which is the
 * whole of C3 in one return value. Used by the key, so the figure a reader is
 * given is the figure for the country they are looking at rather than a
 * globe-wide average that is true nowhere.
 *
 * @param {number} stepDeg Lattice step.
 * @param {number} latDeg Latitude to measure the width at.
 * @returns {{latKm:number, lonKm:number}}
 */
export function irveMeshCellKm(stepDeg, latDeg) {
  const step = Number(stepDeg);
  if (!Number.isFinite(step) || step <= 0) return { latKm: 0, lonKm: 0 };
  const lat = Number.isFinite(latDeg) ? latDeg : 46.5;
  return {
    latKm: step * 111.2,
    lonKm: step * 111.32 * Math.cos((lat * Math.PI) / 180),
  };
}

/**
 * A mesh site is a 4-tuple, not an object: `[lat, lon, pdc, band]`.
 *
 * 39 859 of them travel to the browser in one document, and objects with
 * four keys apiece cost 2.4 MB where tuples cost 0.9 MB (measured). The
 * index constants exist so no caller has to remember the order.
 */
export { MESH_LAT, MESH_LON };
/** The charge-point names for the generic weight and category slots. */
export const MESH_PDC = MESH_WEIGHT;
export const MESH_BAND = MESH_CATEGORY;

/**
 * Grid the view is bucketed into.
 *
 * 30 × 20 = 600 cells, deliberately BELOW every budget below: when cells
 * outnumber the budget, only the highest-ranked cells win and the pick
 * silently becomes rank-based again — the exact failure this grid exists to
 * prevent. Keeping cells < budget guarantees every occupied cell is
 * represented before a single second dot is placed anywhere.
 */
export const IRVE_MESH_COLS = MESH_COLS;
export const IRVE_MESH_ROWS = MESH_ROWS;

/**
 * Budget by how much of the world is on screen, measured in degrees of
 * LATITUDE.
 *
 * Latitude and not the larger of the two spans: on the app's 16:10 viewport
 * the longitude span runs about 2.4× the latitude one (measured — 9.53° lat
 * against 24.42° lon at 1 400 km), so the larger span is mostly a statement
 * about the window's aspect ratio. Latitude is the axis that answers "how far
 * out am I", and it is the one metropolitan France's 9.8° height is measured
 * against.
 *
 * Rising as you zoom in is the point: the mesh should densify continuously
 * into the exact per-site view rather than jump. The ceiling is set by what
 * stays legible as separate dots at that scale, not by what the client could
 * draw — it could draw all 39 579 and they would be a smear.
 */
export const IRVE_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, budget: 2200 }),
  Object.freeze({ maxLatSpanDeg: 2.5, budget: 1600 }),
  Object.freeze({ maxLatSpanDeg: Infinity, budget: 1100 }),
]);

/**
 * Budget for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function irveMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, IRVE_MESH_BUDGETS);
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshSiteInBox(site, box) {
  return meshRowInBox(site, box);
}

/**
 * Stable identity for a mesh site, matching the key the exact regime uses so
 * a selection can survive the handover between the two.
 */
export function meshSiteId(site) {
  return meshRowId(site);
}

/**
 * The site that represents a cell: the largest example of the cell's most
 * common band. See the header for the 46%-vs-12% measurement behind this.
 *
 * The bucket is assumed already sorted largest-first, so the first match is
 * the largest of the modal band. Ties between equally common bands go to the
 * lower band index, which is deterministic and errs toward slower charging —
 * the side that over-claims nothing.
 *
 * @param {Array<Array<number>>} bucket Sites in one cell, sorted by pdc.
 * @returns {Array<number>}
 */
export { cellRepresentative };

/**
 * Pick a bounded, spatially-spread subset of the sites inside a box.
 *
 * @param {Array<Array<number>>} sites National mesh tuples.
 * @param {object} options
 * @param {{south:number, west:number, north:number, east:number}} options.box
 * @param {number} [options.budget] Defaults to the tier for the box's span.
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @param {number} [options.stepDeg] Lattice step. Defaults to the tier for the
 *   box's span; pass `0` to fall back to the view-relative grid.
 * @returns {{picked:Array<Array<number>>, inBox:number, budget:number,
 *   thinned:boolean, cells:number, stepDeg:?number, coarsened:number,
 *   aggregates:?Array<{total:number, rows:number}>}}
 */
export function selectIrveMesh(sites, { box, budget, cols, rows, stepDeg } = {}) {
  if (!box) {
    return {
      picked: [], inBox: 0, budget: 0, thinned: false, cells: 0,
      stepDeg: null, coarsened: 0, aggregates: null,
    };
  }
  const step = stepDeg === undefined ? irveMeshStepDeg(box.north - box.south) : Number(stepDeg);
  return selectGeoMesh(sites, {
    box,
    budget: Number.isFinite(budget) ? budget : irveMeshBudget(box.north - box.south),
    cols,
    rows,
    lattice: step > 0 ? { stepDeg: step } : undefined,
  });
}
