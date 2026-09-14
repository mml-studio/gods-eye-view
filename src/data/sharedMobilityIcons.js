/**
 * @module sharedMobilityIcons
 *
 * The mark a shared vehicle wears on the globe: a PLATE that carries its
 * operator, with its form factor punched through.
 *
 * A GBFS feed states the physical object in `vehicle_types.json` (`form_factor`
 * + `propulsion_type`), and `gbfsFeeds.vehicleKindFromType()` folds that pair
 * to one of six kinds. Separately, the PAN catalog says who publishes it. Those
 * are independent facts and they get independent channels — see
 * `mobilityOperators.js`, which owns the colour half.
 *
 * ── WHY A PLATE, AND NOT A BARE SILHOUETTE ──────────────────────────────────
 *
 * Until 2026-09-14 this module drew Material Symbols' vehicle glyphs as bare
 * white silhouettes and let `billboard.color` tint them. It was replaced on a
 * measurement, not a preference.
 *
 * The layer draws at 17 CSS px on a `scaleByDistance` ramp of 0.4–1.15, so the
 * real band is 7 to 20 px. Rasterised at those sizes and counted, Material's
 * `pedal_bike` puts **86 px² of operator colour out of 88 into ONE contiguous
 * patch at 17 px**: its own counters close and the bicycle collapses into a
 * blob. Every kind does the same thing at a slightly different size. That is
 * why four operators in one Paris street read as "the same shape in another
 * colour" — the shape channel was already gone, and only the colour was left to
 * carry a distinction the eye then had to make between four saturated hues
 * scattered across thin, broken strokes.
 *
 * The plate fixes the half that was actually broken. The colour becomes one
 * deliberate disc with a hard dark ring instead of an accidental blob with a
 * ragged edge, and the silhouette — now punched OUT of that disc rather than
 * drawn in the operator's hue — gets its contrast from the plate instead of
 * from whatever terrain happens to be underneath.
 *
 * This deliberately contradicts the rule `militarySiteIcons.js` records, that a
 * PLACE wears a plate and a MOVING OBJECT does not. A shared vehicle is not a
 * moving object: GBFS publishes a vehicle only while it is PARKED and
 * available, and never during a rental. Every dot in this layer is somewhere
 * you walk to, which is what the plate says.
 *
 * ── TINT-SAFE BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * Cesium multiplies `billboard.color` into the texture, so the plate is drawn
 * WHITE and every ring is drawn BLACK: white × c = c, and 0 × c = 0. One sprite
 * per kind then serves all 84 operators, the layer keeps spending
 * `billboard.color` on the operator, and the cyan selection tint keeps working
 * without a second set of images. A hue baked into the artwork would fight the
 * multiply and destroy both channels — the failure `cctv.js` records.
 *
 * ── THE MONOGRAM, AND WHY IT IS NOT A LOGO ──────────────────────────────────
 *
 * Colour alone cannot close the "who" channel: 84 operators resolve across the
 * French catalogue against a 17-slot palette, so hues collide by construction.
 * The second half is the operator's INITIAL, punched into a badge on the plate
 * (`interCapitals.js`).
 *
 * Operator logos were the obvious alternative and were measured on 2026-09-14
 * rather than assumed. Three findings, each independently fatal:
 *
 * • **There is no feed to read them from.** GBFS v2.3 defines
 *   `system_information.brand_assets.brand_image_url`. Of 158 French systems
 *   probed from `config/gbfs_fr_systems.json`, 146 answered and **zero**
 *   publish it. (0 of 154 on 2026-09-01, so this is stable, not a bad day.)
 *
 * • **Scraping them produces the WRONG mark, silently.** Of ten major
 *   operators' own sites, Lime, Voi and Vélib' answer 403 to a plain fetch —
 *   and `cityscoot.eu`, whose operator went bankrupt in 2024 while staying in
 *   the catalogue, now serves the favicons of an unrelated squatted site. A
 *   pipeline would have put that logo on the map without raising anything.
 *
 * • **A wordmark does not survive map size.** Rendered at true scale, the marks
 *   split in two: the ones that are ALREADY a single bold letterform (Pony's P,
 *   Vélo'v's V) read from 12 px, while dott, BIRD, Voi and Lime are an
 *   illegible smudge below ~24 px. The letter is what worked, so the letter is
 *   what ships — and it carries no trademark, which the 85 distinct operator
 *   identities in the catalogue would each have required separately.
 */

import { interCapitalMarkup } from './interCapitals.js';
import { mapIconArtwork } from './mapIcons.js';

/**
 * This module's own coordinate box, shared with `militarySiteIcons.js` so the
 * two plate packs compose identically.
 */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and its ring, in box units.
 *
 * Same figures as `militarySiteIcons.js`: the plate carries the hue, the ring
 * carries the edge, and 7 units is what keeps a pale plate off a pale roof. The
 * two packs draw on the same globe and a plate that differed between them would
 * read as two renderers.
 */
const DISC_R = 40;
const RING_W = 7;

/**
 * Ring colour — the same black as the military plate, and darker than the
 * fleet's `rgba(0,0,0,0.62)` halo on purpose: a halo is a soft shadow around
 * ink that already reads, while this ring is the mark's only edge.
 */
const RING_COLOR = 'rgba(0,0,0,0.88)';

/**
 * The operator badge: a smaller plate riding the upper right of the main one.
 *
 * 20 units of radius is the smallest that still lets a capital read, and the
 * largest that keeps the badge's own ring INSIDE the 96 box: at (69, 27) the
 * outer edge lands at 91.25 and 4.75. A badge that overflowed would be clipped
 * by the canvas on two sides, which is the same mistake `mapIcons.js` records
 * for an unpadded viewBox — and it showed as a flat-topped badge in the first
 * contact sheet.
 *
 * Upper RIGHT because every vehicle silhouette here is wide and low — a
 * bicycle, a scooter and a car all leave their top-right corner empty.
 *
 * The badge only rides the plate at the near end of the layer's ramp. See
 * `sharedMobilityFrance.js`: below ~20 CSS px a capital is noise, so the layer
 * asks for the plain plate instead of drawing a letter nobody can read.
 */
const BADGE_CX = 69;
const BADGE_CY = 27;
const BADGE_R = 20;
const BADGE_RING_W = 4.5;
/** Cap height of the monogram, and the baseline it sits on, in box units. */
const BADGE_CAP = 22;
const BADGE_BASELINE = BADGE_CY + BADGE_CAP / 2;

/**
 * Cap height of the legend's monogram, which takes the whole plate.
 *
 * 52 of the 80-unit plate diameter: big enough to read at the 32 px a key row
 * draws, small enough that a round `O` and the plate's own edge do not touch.
 */
const LEGEND_MONOGRAM_CAP = 52;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is GPU-minified into mush; 88 covers the
 * 7–30 CSS px band this layer draws at, the same figure the three sibling packs
 * record.
 */
const GLYPH_RASTER_PX = 88;

/**
 * Material Symbols artwork, verbatim — now ONE glyph, not five.
 *
 * `electric_scooter` stays because no permissively-licensed cartographic set
 * publishes a kick scooter: checked across all 557 Temaki icons and the whole
 * Maki set on 2026-09-14. The other four moved to Maki for the legibility
 * reason this module's header records, and their path data is gone from this
 * project rather than merely unused.
 *
 * Fetched from
 * `https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`
 * on 2026-09-01. `sharedMobilityIcons.test.mjs` asserts this string is what the
 * module actually draws, so artwork drift is a failing test rather than a
 * silent redraw. Licence: Apache-2.0, see `licenses/material-symbols/NOTICE`.
 */
export const MATERIAL_SYMBOL_PATHS = Object.freeze({
  electric_scooter: 'M200-240q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T312-400h212q11-68 56.5-119T692-590l-56-250H520q-17 0-28.5-11.5T480-880q0-17 11.5-28.5T520-920h116q28 0 50 17t28 45l69 309q2 11-5 20t-18 9q-63 0-108.5 42.5T601-373q-2 23-18 38t-39 15H312q-12 35-42.5 57.5T200-240Zm560 0q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35ZM520-120v48q0 11-9.5 17T491-54l-173-87q-7-4-5.5-11.5t9.5-7.5h118v-48q0-11 9.5-17t19.5-1l173 87q7 4 5.5 11.5T638-120H520Z',
});

/** Material's own coordinate box, kept as published rather than rescaled. */
const MATERIAL_BOX = 960;

/**
 * What each vehicle kind punches through its plate, and how much of the plate
 * it takes.
 *
 * The fractions are not uniform because the artwork is not: Maki's car fills
 * its box corner to corner while its bicycle leaves air above and below the
 * frame. Each is set so the silhouette reads at 17 px without eating the hue
 * that names its operator.
 *
 * `moped` takes Maki's `scooter` — a Vespa — on the evidence rather than by
 * preference: every moped row in every reachable French `vehicle_types.json` is
 * an electric machine of exactly that shape. `scooter` (the kick scooter) keeps
 * Material's `electric_scooter` because no cartographic set draws one.
 *
 * `other` punches a plain disc. The feed did not say what the object is, and a
 * disc states exactly that; borrowing another kind's silhouette would assert
 * something never published — the rule `transitFrance.js` follows for a vehicle
 * with no bearing.
 */
const KIND_PUNCH = Object.freeze({
  bike: Object.freeze({ borrow: Object.freeze(['maki', 'bicycle']), fraction: 0.66 }),
  ebike: Object.freeze({ borrow: Object.freeze(['maki', 'bicycle']), fraction: 0.66, electric: true }),
  scooter: Object.freeze({ material: 'electric_scooter', fraction: 0.68 }),
  moped: Object.freeze({ borrow: Object.freeze(['maki', 'scooter']), fraction: 0.70 }),
  car: Object.freeze({ borrow: Object.freeze(['maki', 'car']), fraction: 0.74 }),
  other: Object.freeze({ markup: `<circle cx="${CENTRE}" cy="${CENTRE}" r="17"/>`, box: VIEW, fraction: 1 }),
});

/**
 * The electric badge: Maki's bolt, punched low-left where no silhouette reaches.
 *
 * Only `ebike` carries it. A trottinette and a moped do not need one — the
 * French feeds contain no human-powered kick scooter and no combustion moped,
 * so a badge there would discriminate nothing and only spend ink.
 */
const ELECTRIC_BOLT = Object.freeze({
  borrow: Object.freeze(['maki', 'charging-station']),
  fraction: 0.30,
  cx: 25,
  cy: 70,
});

/**
 * A dock is a PLACE, not a vehicle, and it is drawn as one.
 *
 * A ground rail with three posts reads as somewhere that stays put while its
 * contents come and go. Material's `bike_dock` renders as a plain bollard and
 * reads as nothing at any size. Authored directly in the 96 box.
 *
 * Legend-only in practice: the map draws a station as a `PointPrimitive` whose
 * fill is its availability and whose ring is its operator, because a dock
 * publishes a number to act on that no vehicle has.
 */
const STATION_PUNCH = Object.freeze({
  markup: '<rect x="18" y="55" width="60" height="8" rx="4"/>'
    + '<rect x="27" y="31" width="8" height="26" rx="4"/>'
    + '<rect x="44" y="31" width="8" height="26" rx="4"/>'
    + '<rect x="61" y="31" width="8" height="26" rx="4"/>',
  box: VIEW,
  fraction: 1,
});

/**
 * Every kind this module can draw, in legend order: the six vehicle kinds, then
 * the dock.
 *
 * There is no separate e-moped. `vehicleKindFromType()` returns `moped` for
 * `form_factor: 'moped'` whatever the propulsion, and since every French moped
 * row is electric a split would discriminate nothing.
 */
export const SHARED_MOBILITY_GLYPH_KINDS = Object.freeze([
  ...Object.keys(KIND_PUNCH),
  'station',
]);

/** @type {Map<string, string>} kind@px+initial → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it and centred on `cx`/`cy`.
 *
 * A transform, never a rewrite: the vendored coordinates reach the SVG renderer
 * untouched, which is the claim both CC0 notices make and the reason the
 * artwork is still the artwork that was judged.
 *
 * @param {string} geometry `<path>` markup.
 * @param {number} box Authoring box of that markup.
 * @param {number} fraction Share of the 96-unit box the artwork should occupy.
 * @param {number} [cx=CENTRE] Horizontal centre in box units.
 * @param {number} [cy=CENTRE] Vertical centre in box units.
 * @returns {string} The markup wrapped in a centring transform.
 */
function fitted(geometry, box, fraction, cx = CENTRE, cy = CENTRE) {
  const scale = (VIEW * fraction) / box;
  const size = box * scale;
  const x = cx - size / 2;
  const y = cy - size / 2;
  return `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) `
    + `scale(${scale.toFixed(5)})">${geometry}</g>`;
}

/**
 * Resolve one punch spec to markup already fitted into the 96-unit box.
 *
 * @param {Object} spec An entry of {@link KIND_PUNCH}, {@link STATION_PUNCH} or
 *   {@link ELECTRIC_BOLT}.
 * @returns {?string} SVG markup, or null when a vendored icon has gone missing.
 */
function fittedSpec(spec) {
  if (spec.markup) return fitted(spec.markup, spec.box, spec.fraction, spec.cx, spec.cy);
  if (spec.material) {
    // Material authors in `0 -960 960 960` — the box sits ABOVE the origin, so
    // it is translated down into a `0 0 960 960` space before being fitted.
    // A translate, like every other placement here: no coordinate is rewritten.
    const geometry = `<g transform="translate(0 ${MATERIAL_BOX})">`
      + `<path d="${MATERIAL_SYMBOL_PATHS[spec.material]}"/></g>`;
    return fitted(geometry, MATERIAL_BOX, spec.fraction, spec.cx, spec.cy);
  }
  const artwork = mapIconArtwork(...spec.borrow);
  // A vendored icon that disappeared upstream must not silently become a bare
  // plate: every kind here is pinned by `sharedMobilityIcons.test.mjs`.
  if (!artwork) return null;
  return fitted(artwork.geometry, artwork.box, spec.fraction, spec.cx, spec.cy);
}

/**
 * The geometry one kind punches through its plate.
 * @param {string} kind A key of {@link SHARED_MOBILITY_GLYPH_KINDS}.
 * @returns {string} SVG markup — never empty for a known kind.
 */
function punchFor(kind) {
  if (kind === 'station') return fittedSpec(STATION_PUNCH) || '';
  const spec = KIND_PUNCH[kind] || KIND_PUNCH.other;
  const body = fittedSpec(spec) || '';
  if (!spec.electric) return body;
  return body + (fittedSpec(ELECTRIC_BOLT) || '');
}

/**
 * Fold an arbitrary kind string onto a drawable glyph.
 *
 * An unmapped kind falls to `other` — a disc — rather than borrowing another
 * kind's silhouette and asserting something the feed never said.
 *
 * @param {string} kind Kind from `gbfsFeeds.vehicleKindFromType()`.
 * @returns {string} A key of {@link SHARED_MOBILITY_GLYPH_KINDS}.
 */
export function sharedMobilityGlyphKind(kind) {
  const key = String(kind);
  return SHARED_MOBILITY_GLYPH_KINDS.includes(key) ? key : 'other';
}

/**
 * The mark one object wears: an operator plate with its form factor punched
 * through, and optionally the operator's monogram badged on it.
 *
 * The whole image is WHITE artwork over BLACK rings, so `billboard.color`
 * carries the operator and the rings survive the multiply. Nothing here has a
 * hue of its own.
 *
 * @param {string} kind Vehicle kind, or `station`.
 * @param {Object} [options]
 * @param {number} [options.px=GLYPH_RASTER_PX] Raster size.
 * @param {?string} [options.initial=null] Operator monogram, one capital as
 *   `interCapitals.interCapitalFor()` returns it. Null draws no badge — which
 *   is what an operator whose label carries no Latin letter must get, rather
 *   than a letter its name does not contain.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sharedMobilityGlyph(kind, options = {}) {
  const { px = GLYPH_RASTER_PX, initial = null } = options;
  const key = sharedMobilityGlyphKind(kind);
  const letter = initial ? String(initial).slice(0, 1).toUpperCase() : '';
  const cacheKey = `${key}@${px}:${letter}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punchFor(key);
  // Mask ids are local to their own document and each glyph is its own data
  // URI, so no two of these can collide however many are on screen.
  const plateMask = '<mask id="p" maskUnits="userSpaceOnUse"'
    + ` x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff"/>`
    + `<g fill="#000000">${punch}</g></mask>`;

  const badgeMarkup = letter ? badgeFor(letter) : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">${plateMask}${badgeMarkup.mask || ''}`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R + RING_W / 2}" fill="${RING_COLOR}"/>`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff" mask="url(#p)"/>`
    + (badgeMarkup.body || '')
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * A plate carrying NOTHING BUT the operator's monogram, for the legend.
 *
 * The map plate badges its letter in a corner so the silhouette keeps the
 * middle; a legend row has no silhouette to protect and is drawn at 32 px, so
 * the letter takes the whole plate. Same two channels, same tint contract —
 * `manager.js` masks this swatch and fills it with the row's colour, so the key
 * shows the operator's hue AND the letter its plates carry up close.
 *
 * @param {?string} initial One capital, or null.
 * @param {Object} [options]
 * @param {number} [options.px=GLYPH_RASTER_PX] Raster size.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null when there is no
 *   letter to draw — a row with no monogram must fall back to its plain colour
 *   swatch rather than show an empty disc that looks like a kind.
 */
export function sharedMobilityMonogramGlyph(initial, { px = GLYPH_RASTER_PX } = {}) {
  const letter = initial ? String(initial).slice(0, 1).toUpperCase() : '';
  if (!letter) return null;
  const cacheKey = `monogram@${px}:${letter}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const outline = interCapitalMarkup(letter, {
    capPx: LEGEND_MONOGRAM_CAP,
    cx: CENTRE,
    baseline: CENTRE + LEGEND_MONOGRAM_CAP / 2,
  });
  if (!outline) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">`
    + '<mask id="m" maskUnits="userSpaceOnUse"'
    + ` x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff"/>`
    + `<g fill="#000000">${outline}</g></mask>`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R + RING_W / 2}" fill="${RING_COLOR}"/>`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff" mask="url(#m)"/>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * The monogram badge, as a mask and the two circles that use it.
 *
 * THE LETTER IS A HOLE IN A HOLE. The badge plate is white — so the tint
 * reaches it — and the capital is punched out of it, revealing the black badge
 * ring drawn underneath. The letter therefore renders in the ring's black on
 * the operator's hue, at every tint, with no second colour anywhere in the
 * file. Painting the letter dark directly would have baked a hue that
 * `billboard.color` then multiplied into something else.
 *
 * @param {string} letter One capital.
 * @returns {{mask: string, body: string}} Empty strings for an unknown letter.
 */
function badgeFor(letter) {
  const outline = interCapitalMarkupSafe(letter);
  if (!outline) return { mask: '', body: '' };
  const mask = '<mask id="b" maskUnits="userSpaceOnUse"'
    + ` x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="${BADGE_R}" fill="#ffffff"/>`
    + `<g fill="#000000">${outline}</g></mask>`;
  const body = `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="${BADGE_R + BADGE_RING_W / 2}" fill="${RING_COLOR}"/>`
    + `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="${BADGE_R}" fill="#ffffff" mask="url(#b)"/>`;
  return { mask, body };
}

/** Placement of one capital in the badge, or null if it is not vendored. */
function interCapitalMarkupSafe(letter) {
  return interCapitalMarkup(letter, {
    capPx: BADGE_CAP,
    cx: BADGE_CX,
    baseline: BADGE_BASELINE,
  });
}

/** Raw geometry, for tests that assert the punches actually differ. */
export function _sharedMobilityGlyphBodyForTest(kind) {
  return punchFor(sharedMobilityGlyphKind(kind));
}

/** The kind → punch spec map, for the artwork-drift guard. */
export function _sharedMobilityKindPunchForTest() {
  return { ...KIND_PUNCH, station: STATION_PUNCH, _bolt: ELECTRIC_BOLT };
}

/** Plate geometry, for the tests that pin the tint and the box. */
export function _sharedMobilityPlateForTest() {
  return {
    VIEW, CENTRE, DISC_R, RING_W, RING_COLOR,
    BADGE_CX, BADGE_CY, BADGE_R, BADGE_RING_W, BADGE_CAP,
    LEGEND_MONOGRAM_CAP, GLYPH_RASTER_PX,
  };
}
