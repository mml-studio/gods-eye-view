/**
 * @module irveMarkIcons
 *
 * The MARK of a charge point: a tinted plate with a bolt punched out of it.
 *
 * ── THE MEASUREMENT THIS EXISTS TO ANSWER ───────────────────────────────────
 *
 * A reader looked at Bordeaux from 12 653 m, straight down, over Google's
 * photorealistic imagery, and said the charge points were barely there. They
 * were right, and the proof they offered is the finding: *nobody else could
 * find them in the screenshot either.* Counted in that exact view — **318
 * marks, every one a 7 px disc** with a one-pixel hairline, over a city of red
 * roofs, grey streets and a brown river.
 *
 * ── WHY THE HEIGHT CHANNEL DID NOT SAVE IT ──────────────────────────────────
 *
 * The beam carries the charge-point count, and it is a real channel — but it is
 * a WORLD vertical, so what reaches the screen is `L · cos(tangage)`. Measured
 * in that same view, at the nadir the reader was actually using: the shortest
 * beam on screen was **1.1 px**. Beams survive at the edges of the frame, where
 * the local up is tilted away from the view axis, and die in the middle, which
 * is where a reader looks. A quantity channel that vanishes at the commonest
 * map-reading angle cannot also be the legibility channel. The mark has to
 * carry legibility on its own, at every camera attitude.
 *
 * ── WHY A PLATE, AND NOT A BIGGER DOT ───────────────────────────────────────
 *
 * A bigger dot answers "I cannot see it" and leaves "I cannot tell what it is".
 * The reader asked for both: *« sans devoir plisser les yeux et regarder des
 * couleurs qui sont des petits points »*. A plate with a silhouette in it is
 * the answer this repository has already converged on twice, and both times
 * against a measurement rather than a taste:
 *
 *   - `militarySiteIcons.js` rendered bare shapes over three crops of a real
 *     Gironde capture — forest, urban, water — and found them unfindable below
 *     18 px, where a plate is still a plate at 10.
 *   - `plantFiliereIcons.js` took the same route for the EDF fleet and states
 *     the distinction that decides it: *a vehicle is a moving object a reader
 *     follows, a power station is a PLACE on a photograph of places, competing
 *     with roofs, fields and rivers for the same pixels. Marks for places carry
 *     a plate.* A charge point is a place.
 *
 * This module is that module's shape, borrowed deliberately rather than
 * re-derived: same 96-unit box, same plate radius, same ring, same mask, same
 * tint-safety. Two marker packs that solved one problem differently would be
 * telling a reader that two identical situations are different.
 *
 * ── WHY A BOLT, AND NOT A CHARGING STATION ──────────────────────────────────
 *
 * Material publishes `ev_station`, which is literally the subject — and it is
 * the wrong glyph here, for the reason `plantFiliereIcons.js` rejected a bare
 * cooling tower. `ev_station` is a PUMP BODY with a small bolt inside it and a
 * connector on its flank; punched into a disc of radius 40/96 at the sizes this
 * layer draws, the bolt closes up and what survives is a pump — which is the
 * picture of a petrol station. Asserting the wrong object is worse than
 * asserting less.
 *
 * `bolt` is one solid mass with no interior detail to lose, it is the sign this
 * layer's own cards already print (`⚡ 150 kW max`), and it is what the plug
 * standards themselves draw. It says *electricity here*, which is exactly the
 * whole of what a charge point claims.
 *
 * ── AND THE REFUSAL IS A HOLLOW PLATE, NOT A GREY ONE ───────────────────────
 *
 * 3.3 % of the register publishes a power outside any real envelope — watts in
 * a kilowatt column, or a zero. D3 asks for a MOTIF and not a tint where a
 * value is refused, and `irveFrance.js` already drew that refusal as a hollow
 * ring when the mark was a disc. It stays hollow here: the same plate with no
 * fill, the bolt still punched through its rim, so the mark still says *a
 * charge point is here* while its empty middle says *and we could not read how
 * fast*. A motif also survives the NVG and FLIR passes that a tint does not.
 *
 * ── FOUR RASTERS FOR THE WHOLE FLEET ────────────────────────────────────────
 *
 * Solid-punched, solid-plain, hollow-punched, hollow-plain. The band colour is
 * `billboard.color`, never baked into the artwork, so 4 000 marks in six bands
 * cost four atlas entries rather than one per mark — the trap
 * `cesium-particules-et-billboards-traps` records, and the reason nothing here
 * builds a canvas.
 *
 * TINT-SAFE BY CONSTRUCTION. Cesium multiplies `billboard.color` into the
 * texture. The plate is WHITE, so it takes the band colour exactly; the ring
 * behind it is black, and black survives any multiply (0 × c = 0). The punched
 * bolt is a HOLE, so what shows through it is that same ring — a dark bolt on a
 * coloured plate, whose contrast does not depend on what the site sits on. That
 * is also what lets the same rasters serve the on-map key, where the swatch
 * masks them and reads their ALPHA.
 *
 * ATTRIBUTION. `licenses/material-symbols/NOTICE` records that only the `d`
 * path string of `bolt` is vendored and that no coordinate was touched.
 */

/** Glyph coordinate space. Same 96-unit box every other marker pack authors to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and the ring around it, in box units. Identical to
 * `plantFiliereIcons.js` on purpose: two plates of different diameters on one
 * globe would read as a size channel neither layer is spending.
 */
const DISC_R = 40;
const RING_W = 7;
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * Stroke width of the HOLLOW plate, in box units.
 *
 * Fat enough to survive minification — a hairline ring at 16 px is a smudge,
 * which is the failure the punch floor below exists to avoid on the other
 * channel — and thin enough that the middle still reads as EMPTY rather than as
 * a plate with a dot in it.
 */
const HOLLOW_W = 13;

/**
 * Material Symbols Rounded, filled, weight 400 — the `d` string only, verbatim,
 * in Material's own 960-unit box. Retrieved 2026-09-14 at commit
 * 0cbb08816df0, the same commit the other three packs pin, from
 * `symbols/web/bolt/materialsymbolsrounded/bolt_fill1_24px.svg`.
 *
 * @see licenses/material-symbols/NOTICE
 */
const BOLT_PATH = 'M360-360H236q-24 0-35.5-21.5T203-423l299-430q10-14 26-19.5t33 .5q17 6 25 21t6 32l-32 259h155q26 0 36.5 23t-6.5 43L416-100q-11 13-27 17t-31-3q-15-7-23.5-21.5T328-139l32-221Z';

/**
 * Material's own authoring box, and the fact that its origin is not zero.
 *
 * Every other box in this fleet spans `0 → box` on both axes; Material's spans
 * `0 → 960` in x and `-960 → 0` in y. Fitting it therefore needs its y origin,
 * not just its size — and getting that wrong draws the glyph one full box below
 * the plate, which renders as an empty pastille rather than as an error.
 */
const MATERIAL_BOX = 960;
const MATERIAL_Y_ORIGIN = -960;

/**
 * Share of the 96-unit box the bolt occupies.
 *
 * A bolt is a tall narrow mass with empty box on either side, so it can take
 * more of the plate than a square glyph could: its half-diagonal at fraction
 * `f` is well under `0.707 × 96f` because the artwork does not fill its own
 * corners. 0.66 puts the tip and the tail inside the disc with a margin of
 * coloured plate around them, which is what keeps the mark reading as a
 * BAND-COLOURED plate rather than as a black bolt.
 */
const BOLT_FRACTION = 0.66;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is minified into mush; 88 covers the
 * 16–30 CSS px band this layer draws at, the same figure the sibling packs
 * record.
 */
export const IRVE_MARK_RASTER_PX = 88;

/**
 * On-screen pixel side at or above which the plate is punched.
 *
 * 16, where `plantFiliereIcons.js` needs 20 — and the difference is the
 * artwork, not a looser standard. That pack punches a water drop whose
 * highlight crescent closes up first; a bolt has no interior detail to lose, so
 * it survives being punched into a disc of radius 40/96 several pixels further
 * down. Below it the mark hands back the FULL plate: the band colour still
 * names the power and the key still decodes the colour, so one channel narrows
 * rather than both vanishing.
 *
 * The decision is made on the mark's OWN pixel side, which this layer resolves
 * once per rebuild from the in-view count — so it costs one branch per repaint
 * rather than a per-frame pass, and a mark never swaps artwork under a reader
 * who is only flying towards it.
 */
export const IRVE_MARK_PUNCH_MIN_PX = 16;

/** @type {Map<string, string>} variant@px → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it.
 *
 * A transform, never a rewrite: the vendored coordinates are handed to the SVG
 * renderer untouched, which is the claim the notice makes and the reason the
 * artwork is still the artwork that was judged.
 *
 * @param {string} geometry `<path>` markup.
 * @param {number} box Authoring box of that markup.
 * @param {number} fraction Share of the 96-unit box the artwork should occupy.
 * @param {number} [yOrigin=0] Top edge of the authoring box on the y axis.
 * @returns {string} The markup wrapped in a centring transform.
 */
function fitted(geometry, box, fraction, yOrigin = 0) {
  const scale = (VIEW * fraction) / box;
  const offset = (VIEW - box * scale) / 2;
  return `<g transform="translate(${offset.toFixed(3)} ${(offset - yOrigin * scale).toFixed(3)}) `
    + `scale(${scale.toFixed(5)})">${geometry}</g>`;
}

/** The bolt, already fitted into the 96-unit box. */
function boltPunch() {
  return fitted(`<path d="${BOLT_PATH}"/>`, MATERIAL_BOX, BOLT_FRACTION, MATERIAL_Y_ORIGIN);
}

/**
 * The mark one charge-point band is drawn with.
 *
 * @param {Object} [options]
 * @param {number} [options.px=IRVE_MARK_RASTER_PX] Raster size.
 * @param {boolean} [options.punched=true] Whether the bolt is punched out.
 * @param {boolean} [options.hollow=false] The refusal: a rim, with no fill.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function irveMarkGlyph({
  px = IRVE_MARK_RASTER_PX, punched = true, hollow = false, key = false,
} = {}) {
  const cacheKey = `${px}:${punched ? 'p' : '-'}${hollow ? 'h' : '-'}${key ? 'k' : '-'}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punched ? boltPunch() : '';
  // The mask id is local to this document, and each glyph is its own data URI,
  // so no two of these can collide however many are on screen.
  const body = hollow
    // A RIM, drawn as a stroked circle rather than as two discs, so the middle
    // is genuinely transparent — a white disc with a hole masked in it would
    // still occlude the imagery behind it at the alpha Cesium composites with.
    ? `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R - HOLLOW_W / 2}" fill="none"`
      + ` stroke="#ffffff" stroke-width="${HOLLOW_W}" mask="url(#m)"/>`
    : `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff" mask="url(#m)"/>`;
  const ring = key
    ? ''
    : (hollow
      // The dark casing of a hollow plate is a rim too, or it would fill the
      // middle back in with black and undo the motif.
      ? `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R - HOLLOW_W / 2}" fill="none"`
        + ` stroke="${RING_COLOR}" stroke-width="${HOLLOW_W + RING_W}"/>`
      : `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R + RING_W / 2}" fill="${RING_COLOR}"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">`
    + `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<rect x="0" y="0" width="${VIEW}" height="${VIEW}" fill="#ffffff"/>`
    + `<g fill="#000000">${punch}</g></mask>`
    + ring + body
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}
