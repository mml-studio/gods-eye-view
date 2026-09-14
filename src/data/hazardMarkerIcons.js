/**
 * @module hazardMarkerIcons
 *
 * The MARK of a Géorisques classified installation — a tinted hazard plate
 * with the warning bang punched out of it.
 *
 * ── THE DEFECT THIS REPLACES, MEASURED ──────────────────────────────────────
 *
 * `georisques.js` drew `addressMarkerGlyph('hazard')`: a triangle in LINE ART,
 * `LINE_STROKE_PX = 7` inside a 96-unit box. Over the Google photorealistic
 * mesh the reported symptom was not "hard to read" but "clearly invisible" —
 * one establishment beside the Trocadéro, drawn at 20 px, that a reader
 * looking for it could not find.
 *
 * The defect is not the total area, and measuring it that way is what hides
 * it. Rasterised and counted at 15 px (2026-09-14), the share of the box that
 * carries the layer's TINT — white, the only value Cesium's multiply leaves as
 * a colour — goes 14.7% for the line triangle against 23.6% for this plate.
 * A ratio of 1.6, which does not sound like the difference between visible and
 * not. What does: at 15 px, `LINE_STROKE_PX = 7` of 96 renders **1.09 CSS
 * pixels wide**. The old mark spreads its ink along a filament one pixel
 * across; this one concentrates it into a continuous mass with an edge. The
 * military pack measured the same thing on three Gironde crops from the other
 * end — bare silhouettes unfindable below 18 px, and a plate still a plate at
 * 10.
 *
 * ── AND 10 PX IS A READING FLOOR, NOT A FINDING ONE ─────────────────────────
 *
 * That last figure is about a mark the eye has already landed on. This same
 * plate at 16 px — one of one, somewhere in a frame of roofs and gardens over
 * Bassussarry — came back as "quasiment invisible", and correctly. Searching a
 * photorealistic mesh is a different task from reading a glyph, and its floor
 * is two to three times higher; `georisques.js` now sizes for the search.
 * Nothing measured above is wrong, it was answering the other question.
 *
 * ── WHY A TRIANGLE AND NOT THE MILITARY PACK'S DISC ─────────────────────────
 *
 * The disc is right where the SHAPE has to name a class, because a disc is a
 * neutral field to punch a class into. Here the shape names the LAYER: a
 * Géorisques mark lands on the same street as the DVF euro, the DPE badge and
 * the PLU plan sheet, and the pointed top is what carries it apart from all
 * three at a glance — the only silhouette in that family with one. So the
 * plate itself is the hazard triangle, and the punch is the bang that has
 * always been inside it.
 *
 * Nothing is vendored, and nothing needs to be: `mapIcons.js` carries no
 * warning triangle, and a triangle with a bang is not artwork anybody authored
 * — it is ISO 7010's W001 and the oldest sign on any road in France. There is
 * no letterform or silhouette here to recognise, which is the same test
 * `militarySiteIcons.js` applied before drawing its own bullseye and shield.
 *
 * ── ROUNDED BY STROKE, NOT BY ARC ───────────────────────────────────────────
 *
 * The corners are round because the plate is stroked with its own fill colour
 * and `stroke-linejoin="round"`, not because three arcs were computed. A sharp
 * 60° corner at 15 px is a single aliased pixel that reads as dirt; the
 * rounding also grows the plate by half the stroke width, which is why the
 * authored triangle is smaller than the box it ends up filling.
 *
 * ── TINT-SAFE BY CONSTRUCTION, like every other pack in this fleet ──────────
 *
 * Cesium multiplies `billboard.color` into the texture. The plate is WHITE, so
 * it takes the severity colour exactly — Seveso, ICPE, declassified — and the
 * ring behind it is black, which survives any multiply (0 × c = 0). The bang
 * is a HOLE, so what shows through it is that same ring: a dark mark on a
 * coloured plate whose contrast does not depend on the roof underneath. A hue
 * baked into the artwork would fight the tint and destroy the one channel this
 * layer spends its colour on.
 *
 * ── THE KEY GETS THE SAME MARK WITH ITS RING REMOVED ────────────────────────
 *
 * The on-map key masks its swatch and a CSS mask reads ALPHA, so the ring —
 * which makes the whole plate opaque — would flatten the mark into a plain
 * triangle. `{ key: true }` omits the ring pass, leaving the bang readable as
 * a transparent shape against the panel.
 */

/** Glyph coordinate space. The same 96-unit box every marker pack authors to. */
const VIEW = 96;

/**
 * The plate, before rounding.
 *
 * Inset from the box because BOTH strokes grow it outward: the plate's own
 * rounding adds PLATE_ROUND/2 and the ring adds RING_W on top. Authored 14→82
 * horizontally and 20→74 vertically, the ring finishes at 1.5 and 94.5 across
 * and at 7.5 and 86.5 down — inside the box on all four sides, which the first
 * draft was not. A plate clipped by its own viewBox loses a corner to the
 * atlas, and a hazard triangle with a flat corner reads as a different sign.
 */
const PLATE_PATH = 'M48,20 L82,74 L14,74 Z';

/**
 * Corner rounding, as a stroke width in box units.
 *
 * 11 of 96 — enough that a 15 px mark has visibly soft corners, small enough
 * that the silhouette is still read as a triangle and not as a blob. Above ~16
 * the three sides start to bow.
 */
const PLATE_ROUND = 11;

/**
 * The ring's own width, outside the rounded plate.
 *
 * 7 units, the figure `militarySiteIcons.js` settled on: enough edge to
 * separate a pale plate from a pale field, narrow enough that it does not eat
 * the hue at the sizes the declassified sites are drawn at.
 */
const RING_W = 7;

/**
 * Ring colour — the same black as the fleet's halo, at a higher alpha.
 *
 * A halo is a soft shadow around ink that already reads. This ring is the
 * mark's only edge, and the only thing between an orange plate and a tiled
 * roof.
 */
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * The bang, punched out of the plate.
 *
 * Placed against the triangle's VISUAL centre, which sits below its
 * geometric one: a bar from y=39 to y=57 and a dot at y=65, both comfortably
 * inside the sides at those heights (half-width 23 and 28 respectively). The
 * dot is a filled circle rather than a zero-length stroke with a round cap,
 * for the reason `addressMarkerIcons.js` already records: not every rasteriser
 * draws the latter.
 */
const BANG = '<path d="M48,39 L48,57" stroke="#000000" stroke-width="9.5" stroke-linecap="round"/>'
  + '<circle cx="48" cy="65" r="5.5" fill="#000000"/>';

/**
 * Raster size.
 *
 * Cesium's billboard atlas has no mipmaps, so a texture much larger than its
 * on-screen footprint is minified into mush. 88 covers the 22–40 CSS px band
 * this layer draws at — the same figure the three sibling packs record, and it
 * still covers the largest of them at a device pixel ratio of 2 (40 × 2 = 80).
 * The band moved up from 14–30 when the mark was measured on screen at 15.9 px
 * and found; see the size constants in `georisques.js`.
 */
export const HAZARD_GLYPH_RASTER_PX = 88;

/** @type {Map<string, string>} px(+key) → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The hazard plate, as a data URI.
 *
 * One mark, no variants: severity travels in `billboard.color` and in the
 * size, never in the shape. That is the rule the fleet's key already states —
 * colour yes, form no — and a second silhouette here would claim the register
 * publishes two kinds of thing when it publishes one.
 *
 * @param {Object} [options]
 * @param {number} [options.px=HAZARD_GLYPH_RASTER_PX] Raster size in pixels.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function hazardPlateGlyph({ px = HAZARD_GLYPH_RASTER_PX, key = false } = {}) {
  const cacheKey = `${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  // The plate, drawn twice: once in the mask as white (what survives), once
  // for real. `stroke` carries the rounding in both passes, so the hole and
  // the plate share one silhouette exactly.
  const plate = (fill, extra = 0) => `<path d="${PLATE_PATH}" fill="${fill}" stroke="${fill}"`
    + ` stroke-width="${(PLATE_ROUND + extra).toFixed(2)}" stroke-linejoin="round"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">`
    + `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `${plate('#ffffff')}${BANG}</mask>`
    // The ring is the same plate, stroked wider, sitting behind. Drawn as a
    // filled shape and not as a stroke-only outline so there is no seam
    // between it and the plate at fractional device-pixel ratios.
    + (key ? '' : plate(RING_COLOR, RING_W * 2))
    + `${plate('#ffffff').replace('/>', ' mask="url(#m)"/>')}`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** The authored geometry, for tests that pin the silhouette and the punch. */
export function _hazardGlyphPartsForTest() {
  return { plate: PLATE_PATH, round: PLATE_ROUND, ringWidth: RING_W, bang: BANG, view: VIEW };
}
