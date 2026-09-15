/**
 * @module amenityFamilyIcons
 *
 * The MARK of an everyday amenity — one per family of `amenitiesFeed.js`: a
 * tinted plate with the family's silhouette punched out of it.
 *
 * ── WHY THIS MODULE EXISTS, AND THE MEASUREMENT THAT FORCED IT ──────────────
 *
 * Until 2026-09-15 this layer drew fourteen families as bare dots, 5 to 12 px,
 * separated by hue alone. Two numbers say why that could not work:
 *
 *   - **Four pairs of the palette sat under ΔE 20**, and seven under ΔE 21 —
 *     `pharmacie`/`banque` at **15,9**, `restaurant`/`commerce` at 18,0,
 *     `boulangerie`/`sport` at 18,8, `courses`/`sport` at 19,0. At 5 to 8 px
 *     over an orthophoto those are the same dot.
 *   - **Every one of the fourteen sat between L\* 32,8 and L\* 63,9.** The old
 *     palette was chosen "mid-dark and warm-leaning", which is a defensible
 *     choice over a flat basemap and the wrong one over live imagery: nothing
 *     in that band separates from a forest, a field or a roof, so the layer had
 *     no contrast channel at all — only fourteen middling hues.
 *
 * A dot cannot be fixed by re-spacing fourteen hues; thirteen families need
 * more separation than a hue wheel has at a fixed lightness. So the load moves:
 * **the silhouette names the family and the plate makes it findable**, and the
 * hue goes back to being the thing a key can explain. `medecinFamilyIcons.js`
 * won this argument for six medical families, `militarySiteIcons.js` for four
 * cyans and `plantFiliereIcons.js` for three — this is the same answer applied
 * to the layer that needed it most.
 *
 * The palette was rebuilt at the same time and against the same constraint;
 * `AMENITY_COLORS` in `amenitiesFrance.js` carries the resulting numbers.
 *
 * ── WHY A PLATE, AND NOT A BARE SILHOUETTE ──────────────────────────────────
 *
 * A shop is a PLACE on a photograph of places. Bare silhouettes were measured
 * unfindable below 18 px over three real orthophoto crops
 * (`militarySiteIcons.js`, which shipped the finding), and this layer draws
 * under 18 px for most of its range. Marks for places carry a plate; marks for
 * moving objects do not.
 *
 * ── WHAT IS BORROWED, AND HOW EACH ONE WAS CHOSEN ───────────────────────────
 *
 * Nothing is drawn from scratch. Eleven glyphs come from Maki (CC0) and one
 * from Material Symbols (Apache-2.0), every one of them picked on a contact
 * sheet rendered over a REAL capture of this application at 30 / 24 / 19 / 15 /
 * 12 px, with Cesium's colour multiply simulated by baking the family tint into
 * the SVG rather than laying an `<img>` over a coloured box.
 *
 * Three families had a Material candidate beaten on that sheet, and the reason
 * is the same each time — **a silhouette keeps its counter-forms or it stops
 * being a silhouette**:
 *
 *   - **boulangerie** — Maki's `bakery` (three scored loaves) over Material's
 *     `bakery_dining` (a fanned croissant). At 12 px the loaves are still three
 *     masses; the croissant's fan closes into a shell that could be any rounded
 *     object.
 *   - **restaurant** — Maki's `restaurant` over Material's. The same fork and
 *     knife, and Maki leaves more ground between them, so they stay TWO masses
 *     at 12 px instead of one vertical block.
 *   - **pharmacie** — Maki's `pharmacy` (a mortar and pestle) over Material's
 *     `local_pharmacy`, **despite Material reading better at 12 px**. Material
 *     draws a cross, and this globe has already spent its crosses: `hopital`
 *     took the bare one on 2026-09-15. A third cross would have left hue as the
 *     only separator between three subjects, which is the failure these plates
 *     exist to end. A mortar is muddy at 12 px and unambiguous above it, and
 *     12 px is this ramp's FLOOR, not its working size.
 *
 * Two more choices are about naming the majority rather than the label:
 *
 *   - **culture** is an open book and not a film reel: 15 676 of the family's
 *     21 179 rows are libraries (74 %), against 1 969 cinemas.
 *   - **commerce** is Material's `storefront` — an awning over a shutter —
 *     rather than a basket. 30 104 of its 51 554 rows are épiceries, and an
 *     awning is the one object that covers a grocer, a butcher and a
 *     fishmonger without naming any of them. Maki's `shop` (a carrier bag) was
 *     the alternative and it goes solid at 12 px, where the awning's stripes
 *     survive.
 *
 * And one is about keeping two neighbours apart: **`courses` is a trolley and
 * `commerce` is a shopfront**, because that is the real difference between
 * where a household's week comes from and the counter you cross the road for.
 *
 * ── THE FAMILY WITH NO SHAPE ────────────────────────────────────────────────
 *
 * `hopital` is absent from this module by design and NOT by omission. The 2 211
 * FINESS establishments moved to `medecins-fr` on 2026-09-15, where they are
 * drawn by `medecinFamilyIcons.js` with Maki's plain cross. Asking this module
 * for it returns the bare plate, which is the honest answer — "an amenity, and
 * this pack cannot tell you which kind" — rather than a shape that would be a
 * claim.
 *
 * ── HOW THE PUNCH IS MADE, AND WHY IT IS A MASK ─────────────────────────────
 *
 * `fill-rule="evenodd"` only spans the subpaths of ONE path element, so it
 * cannot punch a hole through artwork that arrives inside a `<g transform>` —
 * which is every borrowed icon, since fitting a 15- or 960-unit box into this
 * 96-unit plate is a transform. The hole is an SVG `<mask>`: a white disc with
 * the silhouette painted black over it.
 *
 * ── TINT-SAFE BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * Cesium multiplies `billboard.color` into the texture. The plate is WHITE, so
 * it takes the family colour exactly; the ring behind it is black, and black
 * survives any multiply (0 × c = 0). The punched silhouette is a hole, so what
 * shows through it is that ring. No hue is baked into the artwork.
 */
import { mapIconArtwork } from './mapIcons.js';

/** Glyph coordinate space. The same 96-unit box every place pack authors to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and the ring around it, in box units. Identical to
 * `medecinFamilyIcons.js`, `militarySiteIcons.js` and `plantFiliereIcons.js`,
 * deliberately: four packs of PLACE marks that differed by a pixel of edge
 * would read as four renderers on one globe.
 */
const DISC_R = 40;
const RING_W = 7;

/** Ring colour, likewise shared with the sibling place packs. */
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * Material Symbols Rounded, filled, weight 400 — the `d` string in Material's
 * own 960-unit box, NOT rescaled. Retrieved 2026-09-15 at commit 40a7a292a79d
 * from `symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`.
 *
 * @see licenses/material-symbols/NOTICE
 */
const MATERIAL_SYMBOL_PATHS = Object.freeze({
  // An awning over a closed shutter, the shutter drawn as horizontal bands.
  // Those bands are the reason it is here: they are counter-forms, and they are
  // still bands at 12 px where every solid alternative has become a lozenge.
  storefront: 'M201-120q-33 0-56.5-23.5T121-200v-318q-23-21-35.5-54t-.5-72l42-136q8-26 28.5-43t47.5-17h556q27 0 47 16.5t29 43.5l42 136q12 39-.5 71T841-518v318q0 33-23.5 56.5T761-120H201Zm368-440q27 0 41-18.5t11-41.5l-22-140h-78v148q0 21 14 36.5t34 15.5Zm-180 0q23 0 37.5-15.5T441-612v-148h-78l-22 140q-4 24 10.5 42t37.5 18Zm-178 0q18 0 31.5-13t16.5-33l22-154h-78l-40 134q-6 20 6.5 43t41.5 23Zm540 0q29 0 42-23t6-43l-42-134h-76l22 154q3 20 16.5 33t31.5 13Z',
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
 * 7-30 CSS px band `amenitiesFrance.js` draws at, the same figure the three
 * sibling packs record.
 */
export const AMENITY_GLYPH_RASTER_PX = 88;

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it.
 *
 * A transform, never a rewrite: the vendored coordinates are handed to the SVG
 * renderer untouched, which is the claim both notices make and the reason the
 * artwork is still the artwork that was judged.
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
 * The fractions are not uniform because the artwork is not. Maki draws to the
 * edges of its 15-unit box and Material leaves a margin inside its 960, so a
 * single number would make the borrowed cartographic glyphs a fifth larger than
 * the borrowed interface one on the same globe. Each is set so the punched
 * shape reads at 15 px without swallowing the hue that names its family — which
 * is why the densest masses take the smallest share and the two that are mostly
 * LINE (the dumbbell, the awning) take the largest.
 */
const PUNCH = Object.freeze({
  restaurant: Object.freeze({ borrow: Object.freeze(['maki', 'restaurant']), fraction: 0.56 }),
  boulangerie: Object.freeze({ borrow: Object.freeze(['maki', 'bakery']), fraction: 0.58 }),
  commerce: Object.freeze({ markup: MATERIAL_SYMBOL_PATHS.storefront, material: true, fraction: 0.62 }),
  medecin: Object.freeze({ borrow: Object.freeze(['maki', 'doctor']), fraction: 0.56 }),
  banque: Object.freeze({ borrow: Object.freeze(['maki', 'bank']), fraction: 0.58 }),
  sport: Object.freeze({ borrow: Object.freeze(['maki', 'fitness-centre']), fraction: 0.62 }),
  culture: Object.freeze({ borrow: Object.freeze(['maki', 'library']), fraction: 0.56 }),
  courses: Object.freeze({ borrow: Object.freeze(['maki', 'grocery']), fraction: 0.58 }),
  pharmacie: Object.freeze({ borrow: Object.freeze(['maki', 'pharmacy']), fraction: 0.56 }),
  poste: Object.freeze({ borrow: Object.freeze(['maki', 'post']), fraction: 0.56 }),
  carburant: Object.freeze({ borrow: Object.freeze(['maki', 'fuel']), fraction: 0.56 }),
  gendarmerie: Object.freeze({ borrow: Object.freeze(['maki', 'police']), fraction: 0.56 }),
  piscine: Object.freeze({ borrow: Object.freeze(['maki', 'swimming']), fraction: 0.6 }),
});

/** Every family that carries a silhouette. `hopital` is deliberately not one. */
export const AMENITY_SHAPED_FAMILIES = Object.freeze(Object.keys(PUNCH));

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
  // plate: every family here is pinned by `amenityFamilyIcons.test.mjs`.
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
 * Not a fourteenth subject: it is the mark every place pack in this fleet falls
 * back to, kept for the cases where drawing a shape would be a claim — the
 * `hopital` rows this layer no longer draws, and any family a future edition of
 * the register adds. A new family must arrive as "an amenity, and we cannot
 * tell you which kind" rather than wearing whichever of the thirteen looked
 * closest.
 *
 * @param {number} [px=AMENITY_GLYPH_RASTER_PX] Raster size.
 * @param {Object} [options]
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function amenityPlateGlyph(px = AMENITY_GLYPH_RASTER_PX, { key = false } = {}) {
  const cacheKey = `plate@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;
  const uri = plate('', px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * The mark one family of everyday amenity is drawn with.
 *
 * Never null: an unknown family falls back to {@link amenityPlateGlyph}. A
 * caller that needs to know whether a shape actually exists asks
 * {@link AMENITY_SHAPED_FAMILIES}.
 *
 * @param {string|null|undefined} family Family key, as `AMENITY_FAMILIES` holds it.
 * @param {Object} [options]
 * @param {number} [options.px=AMENITY_GLYPH_RASTER_PX] Raster size.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function amenityFamilyGlyph(family, { px = AMENITY_GLYPH_RASTER_PX, key = false } = {}) {
  const name = String(family || '');
  const cacheKey = `${name}@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punchFor(name);
  if (!punch) return amenityPlateGlyph(px, { key });

  const uri = plate(punch, px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw Material path data, for the test that pins the vendored geometry. */
export function _amenitySymbolPathsForTest() {
  return { ...MATERIAL_SYMBOL_PATHS };
}

/** Raw punches, for tests that assert the silhouettes actually differ. */
export function _amenityPunchesForTest() {
  return Object.fromEntries(AMENITY_SHAPED_FAMILIES.map((family) => [family, punchFor(family)]));
}
