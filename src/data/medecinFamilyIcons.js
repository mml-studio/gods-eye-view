/**
 * @module medecinFamilyIcons
 *
 * The MARK of a medical practice — one per family of `medecinsFrFeed.js`: a
 * tinted plate with the family's silhouette punched out of it.
 *
 * ── WHY A SHAPE, WHEN THE KEY ALREADY NAMES THE COLOUR ──────────────────────
 *
 * Because the key is on the other side of the screen and this layer draws six
 * hues at once. Over central Lyon it paints 544 marks, over central Paris 5 907,
 * and none of them carries a label: the layer's only cohort of text is the
 * département names, and those only exist in the national regime, where no
 * practice is drawn at all. A reader looking at a pink dot next to a cyan dot
 * has to hold six colour-to-word pairs in their head, then find the one they
 * want by elimination. A stethoscope is read without the key; so is a cross.
 *
 * This is the argument `militarySiteIcons.js` won for four cyans and
 * `plantFiliereIcons.js` won for three, with the same answer: the silhouette
 * says WHERE the mark is and WHAT it is, and the key keeps saying what the
 * colour means. Neither channel carries the load alone.
 *
 * ── WHY A PLATE, AND NOT A BARE SILHOUETTE ──────────────────────────────────
 *
 * A practice is a PLACE on a photograph of places, competing with roofs,
 * courtyards and streets for the same pixels — and bare silhouettes were
 * measured unfindable below 18 px over three real orthophoto crops
 * (`militarySiteIcons.js`, which shipped the finding). Marks for places carry a
 * plate; marks for moving objects do not. Half the marks here draw under 18 px
 * as soon as the camera leaves street level, so the bare form was never an
 * option.
 *
 * ── WHAT IS BORROWED, AND WHY EACH ONE ──────────────────────────────────────
 *
 * Nothing is drawn from scratch. Three vetted sets, six glyphs, chosen on a
 * contact sheet rendered over a real Lyon capture at 30 / 24 / 19 / 15 / 12 px —
 * the band this layer's own ramp covers — rather than at the size an icon
 * gallery shows them.
 *
 *   - **generaliste** — Maki's `doctor`, a stethoscope. It is that set's own
 *     icon for `amenity=doctors`, which is literally this layer's subject.
 *
 *   - **specialiste** — Maki's `hospital`, a plain cross. The catch-all: 24 of
 *     the register's 46 mapped specialty codes fall here, from cardiology to
 *     dermatology to ORL, and no single object pictures them. So the mark says
 *     "medicine, and nothing narrower" — the job the heater shield does for
 *     `military_land` next door — and the card names the actual specialty. It
 *     is also the only borrowed glyph that survives a 12 px plate intact.
 *
 *   - **femme-enfant** — Material's `escalator_warning`, an adult holding a
 *     child's hand. The name is the context Google drew it for and says nothing
 *     about what it draws; what it draws is the international family pictogram.
 *     Chosen over Material's `gynecology` (a uterus), which covers the family's
 *     7 393 gynaecology entries and says nothing about its 3 709 paediatric
 *     ones, and over `pregnant_woman` for the same reason.
 *
 *   - **sante-mentale** — Material's `psychology`, a head in profile with a
 *     mechanism inside it. The HEAD is what does the work: it is an outline a
 *     reader resolves at 15 px, where Material's `psychiatry` — a bare brain —
 *     is a lobed blob, and Temaki's `psychic` is a palmist's hand, which names
 *     a fortune teller.
 *
 *   - **chirurgie** — Material's `surgical`, a scalpel. Temaki has knives
 *     (`chefs_knife`, `cleaver`, `dagger`) and every one of them says kitchen or
 *     weapon; neither CC0 set publishes a surgical instrument.
 *
 *   - **imagerie** — Temaki's `radiation`, the trefoil, vendored in
 *     `mapIcons.js` with the note on why the bare trefoil is legitimate here and
 *     was rejected for the EDF fleet. Short version: 90.8 % of this family's
 *     40 009 register entries are radiology, nuclear medicine or radiotherapy,
 *     so the sign is the specialty rather than a hazard claim this map has no
 *     data for. `science` (a flask) and `biotech` (a microscope) both read
 *     cleanly at 12 px and both name the 9.2 % instead of the 90.8 %.
 *
 * Maki and Temaki are CC0; the three Material Symbols are Apache-2.0, vendored
 * path-by-path here the way `plantFiliereIcons.js` and `irveMarkIcons.js`
 * already vendor theirs, and recorded in `licenses/material-symbols/NOTICE`.
 *
 * ── HOW THE PUNCH IS MADE, AND WHY IT IS A MASK ─────────────────────────────
 *
 * `fill-rule="evenodd"` only spans the subpaths of ONE path element, so it
 * cannot punch a hole through artwork that arrives inside a `<g transform>` —
 * which is every borrowed icon, since fitting a 15- or 960-unit box into this
 * 96-unit plate is a transform. The hole is an SVG `<mask>`: a white disc with
 * the silhouette painted black over it.
 *
 * ── TINT-SAFE BY CONSTRUCTION, like every other pack in this fleet ──────────
 *
 * Cesium multiplies `billboard.color` into the texture. The plate is WHITE, so
 * it takes the family colour exactly; the ring behind it is black, and black
 * survives any multiply (0 × c = 0). The punched silhouette is a hole, so what
 * shows through it is that ring — a dark shape on a coloured plate, whose
 * contrast does not depend on what the practice happens to sit on. No hue is
 * baked into the artwork.
 */
import { mapIconArtwork } from './mapIcons.js';

/** Glyph coordinate space. Same 96-unit box the other place packs author to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and the ring around it, in box units. Identical to
 * `militarySiteIcons.js` and `plantFiliereIcons.js`, deliberately: three packs
 * of PLACE marks that differed by a pixel of edge would read as three renderers
 * on one globe.
 */
const DISC_R = 40;
const RING_W = 7;

/** Ring colour, likewise shared with the sibling place packs. */
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * Material Symbols Rounded, filled, weight 400 — the `d` string of each glyph
 * in Material's own 960-unit box, NOT rescaled. Retrieved 2026-09-14 at commit
 * 40a7a292a79d from
 * `symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`.
 *
 * @see licenses/material-symbols/NOTICE
 */
const MATERIAL_SYMBOL_PATHS = Object.freeze({
  // An adult and a child, side by side, hands joined. Two separate masses in
  // one path — which is exactly what makes it survive the punch: at 15 px the
  // pair still reads as two figures of different heights, where a single
  // silhouette of the same ink would read as one person.
  escalator_warning: 'M260-720q-33 0-56.5-23.5T180-800q0-33 23.5-56.5T260-880q33 0 56.5 23.5T340-800q0 33-23.5 56.5T260-720Zm420 200q-25 0-42.5-17.5T620-580q0-25 17.5-42.5T680-640q25 0 42.5 17.5T740-580q0 25-17.5 42.5T680-520ZM180-120v-240h-20q-17 0-28.5-11.5T120-400v-200q0-33 23.5-56.5T200-680h120q22 0 40 10.5t29 29.5l143 247 41-61q8-12 21.5-19t28.5-7h117q25 0 42.5 17.5T800-420v100q0 16-14.5 22.5T760-280v160q0 17-11.5 28.5T720-80h-80q-17 0-28.5-11.5T600-120v-244l-20 28q-5 8-13.5 12t-17.5 4h-46q-11 0-19.5-5T470-339l-90-157v376q0 17-11.5 28.5T340-80H220q-17 0-28.5-11.5T180-120Z',
  // A head in profile with a cogged disc inside it. The cog is a counter-wound
  // subpath and stays one: filled in, the head is a featureless lozenge.
  psychology: 'm434-410 4 32q1 8 6.5 13t13.5 5h44q8 0 13.5-5t6.5-13l4-32q8-3 14.5-7t11.5-9l30 13q7 3 14 1t11-9l22-38q4-7 2.5-14t-7.5-12l-26-19q2-8 2-16t-2-16l26-19q6-5 7.5-12t-2.5-14l-22-38q-4-7-11-9t-14 1l-30 13q-5-5-11.5-9t-14.5-7l-4-32q-1-8-6.5-13t-13.5-5h-44q-8 0-13.5 5t-6.5 13l-4 32q-8 3-14.5 7t-11.5 9l-30-13q-7-3-14-1t-11 9l-22 38q-4 7-2.5 14t7.5 12l26 19q-2 8-2 16t2 16l-26 19q-6 5-7.5 12t2.5 14l22 38q4 7 11 9t14-1l30-13q5 5 11.5 9t14.5 7Zm46-50q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460ZM280-80q-17 0-28.5-11.5T240-120v-132q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v40q0 17-11.5 28.5T560-80H280Z',
  // A scalpel held at 45°, blade down-left, over the table rail its tip rests
  // on. One diagonal mass, which is the one thing that still resolves at 12 px.
  surgical: 'M840-120H500q-20 0-30-12.5T460-160q0-15 10.5-27.5T501-200h339q17 0 28.5 11.5T880-160q0 17-11.5 28.5T840-120Zm-450-68q-32 32-74.5 50T227-120h-24q-31 0-60-8t-55-23q-11-7-16.5-17.5T66-191q0-11 4-21t12-18l195-194q12-12 28-12t28 12l76 76q14 14 22 32t8 38q0 20-8 38.5T409-207l-19 19Zm134-186q-12 12-28 12t-28-12l-94-94q-12-12-12-28t12-28l290-290q9-9 20.5-13.5T707-832q11 0 22 4.5t20 13.5l65 65q9 9 13.5 20.5T832-706q0 11-4.5 22T814-664L524-374Z',
});

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
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is minified into mush; 88 covers the
 * 7–30 CSS px band `medecinsFrance.js` draws at, the same figure the three
 * sibling packs record.
 */
export const MEDECIN_GLYPH_RASTER_PX = 88;

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it.
 *
 * A transform, never a rewrite: the vendored coordinates are handed to the SVG
 * renderer untouched, which is the claim all three notices make and the reason
 * the artwork is still the artwork that was judged.
 *
 * @param {string} geometry `<path>` markup.
 * @param {number} box Authoring box of that markup.
 * @param {number} fraction Share of the 96-unit box the artwork should occupy.
 * @param {number} [yOrigin=0] Top edge of the authoring box, in its own units.
 * @returns {string} The markup wrapped in a centring transform.
 */
function fitted(geometry, box, fraction, yOrigin = 0) {
  const scale = (VIEW * fraction) / box;
  const offset = (VIEW - box * scale) / 2;
  return `<g transform="translate(${offset.toFixed(3)} ${(offset - yOrigin * scale).toFixed(3)}) `
    + `scale(${scale.toFixed(5)})">${geometry}</g>`;
}

/**
 * What each family punches into its plate, and how much of the plate it takes.
 *
 * The fractions are not uniform because the artwork is not. Maki and Temaki
 * draw to the edges of their 15-unit box and Material leaves a margin inside
 * its 960, so a single number would make the borrowed cartographic glyphs a
 * fifth larger than the borrowed interface ones on the same globe. Each is set
 * so the punched shape reads at 15 px without swallowing the hue that names its
 * family — which is why the cross, the densest mass of the six, takes the
 * smallest share.
 */
const PUNCH = Object.freeze({
  generaliste: Object.freeze({ borrow: Object.freeze(['maki', 'doctor']), fraction: 0.56 }),
  'femme-enfant': Object.freeze({ markup: MATERIAL_SYMBOL_PATHS.escalator_warning, material: true, fraction: 0.64 }),
  'sante-mentale': Object.freeze({ markup: MATERIAL_SYMBOL_PATHS.psychology, material: true, fraction: 0.62 }),
  specialiste: Object.freeze({ borrow: Object.freeze(['maki', 'hospital']), fraction: 0.52 }),
  chirurgie: Object.freeze({ markup: MATERIAL_SYMBOL_PATHS.surgical, material: true, fraction: 0.62 }),
  imagerie: Object.freeze({ borrow: Object.freeze(['temaki', 'radiation']), fraction: 0.56 }),
});

/** Every family that carries a silhouette — which is every family there is. */
export const MEDECIN_SHAPED_FAMILIES = Object.freeze(Object.keys(PUNCH));

/** @type {Map<string, string>} family@px(+key) → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The silhouette one family punches, already fitted into the 96-unit box.
 * @param {string} family
 * @returns {?string} SVG markup, or null for a family with no mark.
 */
function punchFor(family) {
  const spec = PUNCH[family];
  if (!spec) return null;
  if (spec.markup) {
    return fitted(
      `<path d="${spec.markup}"/>`,
      MATERIAL_BOX,
      spec.fraction,
      spec.material ? MATERIAL_Y_ORIGIN : 0,
    );
  }
  const artwork = mapIconArtwork(...spec.borrow);
  // A vendored icon that disappeared upstream must not silently become a bare
  // plate: every family here is pinned by `medecinFamilyIcons.test.mjs`.
  if (!artwork) return null;
  return fitted(artwork.geometry, artwork.box, spec.fraction);
}

/** Compose one plate, with or without its ring, around an optional punch. */
function plate(punch, px, key) {
  // The mask id is local to this document, and each glyph is its own data URI,
  // so no two of these can collide however many are on screen.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">`
    + `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff"/>`
    + `<g fill="#000000">${punch}</g></mask>`
    + (key ? '' : `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R + RING_W / 2}" fill="${RING_COLOR}"/>`)
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff" mask="url(#m)"/>`
    + '</svg>';
  return `data:image/svg+xml;base64,${_b64(svg)}`;
}

/**
 * The bare pastille, for a family this module has no silhouette for.
 *
 * Not a seventh subject: it is the mark every place pack in this fleet falls
 * back to, kept for the one case where drawing a shape would be a claim. The
 * register can gain a specialty code, `medecinFamily()` folds an unknown code
 * into `specialiste` rather than throwing, and if a seventh family is ever
 * added upstream it must arrive as "a practice, and we cannot tell you which
 * kind" rather than wearing whichever of the six looked closest.
 *
 * @param {number} [px=MEDECIN_GLYPH_RASTER_PX] Raster size.
 * @param {Object} [options]
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function medecinPlateGlyph(px = MEDECIN_GLYPH_RASTER_PX, { key = false } = {}) {
  const cacheKey = `plate@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;
  const uri = plate('', px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * The mark one family of medicine is drawn with.
 *
 * Never null: an unknown family falls back to {@link medecinPlateGlyph}, which
 * is the same pastille this layer drew before it had shapes. A caller that
 * needs to know whether a shape actually exists asks
 * {@link MEDECIN_SHAPED_FAMILIES}.
 *
 * @param {string|null|undefined} family Family key, as `medecinFamily()` emits it.
 * @param {Object} [options]
 * @param {number} [options.px=MEDECIN_GLYPH_RASTER_PX] Raster size.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function medecinFamilyGlyph(family, { px = MEDECIN_GLYPH_RASTER_PX, key = false } = {}) {
  const name = String(family || '');
  const cacheKey = `${name}@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punchFor(name);
  if (!punch) return medecinPlateGlyph(px, { key });

  const uri = plate(punch, px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw Material path data, for the test that pins the vendored geometry. */
export function _medecinSymbolPathsForTest() {
  return { ...MATERIAL_SYMBOL_PATHS };
}

/** Raw punches, for tests that assert the silhouettes actually differ. */
export function _medecinPunchesForTest() {
  return Object.fromEntries(MEDECIN_SHAPED_FAMILIES.map((family) => [family, punchFor(family)]));
}
