import * as Cesium from 'cesium';
import { createAddressScanLayer } from './addressScanLayer.js';
import { ringAnchor } from './communeContours.js';
import { nearFarScalarValueAtDistance } from './focusDeemphasis.js';
import { hazardPlateGlyph } from './hazardMarkerIcons.js';
import { registerPickDecoration } from './pickRegistry.js';
import { surfaceFillDrapesBuildings } from './surfaceFillNotice.js';

/**
 * Géorisques — the state's own risk register, read from wherever the camera is
 * looking.
 *
 * WHAT MAKES THIS LAYER WORTH HAVING. The facts it draws are the same ones a
 * French seller is legally obliged to hand a buyer in the *état des risques* —
 * flood, clay shrinkage, seismicity, radon, industrial sites, polluted soil,
 * hazardous pipelines. That document normally arrives at the compromis, weeks
 * after the decision to buy. Read from a coordinate it arrives before the first
 * visit.
 *
 * ── THE DEFECT THIS VERSION EXISTS TO FIX ───────────────────────────────────
 *
 * Everything above was TRUE and none of it was ON SCREEN. Measured on a live
 * session over the Trocadéro on 2026-09-14, at 555 m: the layer drew one
 * line-art triangle for one classified installation, and drew nothing at all
 * for the eight hazards the same scan had already resolved. The verdicts were
 * fetched, projected, summarised into `getStats()` — and read by no surface of
 * the globe. The only place they rendered was `fiche.html`, which has no link
 * from the map. A reader who turned the layer on saw an empty frame and had no
 * way to learn it was not empty.
 *
 * Three changes answer it, and they are three different problems:
 *
 *   1. THE COMMUNE IS DRAWN, so the verdicts have a subject on screen.
 *   2. THE INSTALLATIONS GET A PLATE instead of a filament — see
 *      `hazardMarkerIcons.js`, which measures the old mark.
 *   3. THE VERDICTS ARE PUBLISHED TO THE KEY, where they are legible without
 *      opening a panel that ships collapsed.
 *
 * ── THE SECOND READING, OVER BASSUSSARRY AT 5 859 M ─────────────────────────
 *
 * Those three shipped, the layer was read again, and two things came back:
 * the installation mark is "beaucoup trop petite, quasiment invisible", and
 * the commune should be HIGHLIGHTED the way the régions are in the
 * electricity mix rather than merely outlined.
 *
 * THE MARK WAS 15.9 PIXELS AND THE CONSTANT SAID 24. Nobody had measured it
 * at the altitude it is read at, because the ramp hides the number: Cesium
 * interpolates a `NearFarScalar` against SQUARED distance and then raises
 * `t` to the power 0.2 (`czm_nearFarScalar`), so the FAR value owns nearly
 * the whole band. On the old ramp — 400/1.0 → 9 000/0.6 — t^0.2 is already
 * 0.38 at 900 m and 0.84 at 5 859 m, which is scale 0.66 and 15.9 px against
 * the 24 declared. So the repair is mostly at the FAR END (0.6 → 0.8), which
 * is the opposite of where a reader of `SIZE_ICPE_PX` would look, and
 * {@link markPixelsAtDistance} exists so the size on screen is checkable
 * rather than inferred.
 *
 * AND "LEGIBLE" IS NOT "FINDABLE". `hazardMarkerIcons.js` measured a plate
 * as still a plate at 10 px, and that measurement stands — it is about
 * reading a mark you have already found. Finding one over a photorealistic
 * mesh of roofs, gardens and parked cars is a different task with a much
 * higher floor, and 16 px was under it. The comparison that settled the new
 * size: a military installation, drawn by `militaryInstallations.js` over
 * the same mesh, is 25 px at that distance.
 *
 * ── THE COMMUNE IS NOW WASHED, AND WHAT KEEPS THAT HONEST ───────────────────
 *
 * The stroke alone lost its subject the moment the reader looked away from
 * it: a cyan line crossing a hillside is a line, and the eleven verdicts
 * keyed beside it are about the ground INSIDE it. So the interior is tinted,
 * and the one objection that mattered — a fill claims an extent — is
 * answered by what the fill is made of rather than by refusing to draw it.
 *
 * A HAZARD EXTENT ON THIS MAP IS WARM AND GRADED. The wash is the
 * interface’s own cyan at {@link COMMUNE_FILL_ALPHA}, flat, outside the
 * hazard ramp entirely, and cut to the commune’s own ring — the same
 * vertices the stroke draws. None of these hazards publishes a geometry
 * through this endpoint (`resultats_rapport_risque` answers "Risque
 * Existant" over a commune and over an address with nothing attached), so
 * nothing here could be read as "the water reaches this far" without also
 * being read as "and stops at the commune line", which no reader believes.
 * The key says what the shape is, the card says it, and the footnote says a
 * third time that the hazards themselves are not drawn.
 *
 * A SEVERITY RAMP WOULD STILL INVENT AN INDEX, and that argument is
 * untouched. Géorisques publishes no composite score, and counting hazards
 * is not one: twelve graded "faible" is not worse than one graded
 * "important", and colouring by the count would say it is. So the wash
 * carries ONE colour and says only "this is the commune the verdicts below
 * are about". The severity lives where the source put it — on each hazard,
 * in its own words, in the key.
 *
 * TWO COSTS COME WITH IT, both disclosed rather than hidden. The wash drapes
 * onto the photorealistic mesh, buildings included (`surfaceFillNotice.js`),
 * which is why `surfaceFill` is now declared and the shared drape note
 * mounts. And a ground-classified fill is PICKABLE — `delinquanceFrance.js`
 * selects a commune by clicking one — so a wash this size would have
 * swallowed every sibling layer’s ground click inside the commune. It is
 * registered as a pick DECORATION instead; see {@link drawCommuneWash}.
 *
 * ── WHAT IS DRAWN AND WHAT IS NOT ───────────────────────────────────────────
 *
 * Classified installations (ICPE) have coordinates, so they are drawn as
 * points. The hazards do not, and they are published to the key with
 * `color: null` — the manager's own "assessed, not mapped" swatch. That slot
 * exists precisely so a key can carry a fact the map could not draw without a
 * colour implying it did.
 *
 * ── THE TWO VERDICTS ARE KEPT APART ─────────────────────────────────────────
 *
 * `communeVerdict` and `addressVerdict` can disagree, and on the Paris 13e two
 * of them do. ICPE reads "Risque Concerne" for the commune and "Risque non
 * Concerne" for the address; retrait-gonflement des argiles reads "Risque
 * Existant - important" for the commune and "Risque non Connu" for the
 * address. That is the difference between "true anywhere around here" and
 * "depends on your street", the upstream computed it, and the key prints both
 * whenever they differ rather than picking one.
 *
 * @module data/georisques
 */

/** Seveso sites first: the one distinction a reader must not have to hunt for. */
const COLOR_SEVESO = Cesium.Color.fromCssColorString('#ff4d3d');
const COLOR_ICPE = Cesium.Color.fromCssColorString('#ffa63d');
const COLOR_DECLASSIFIED = Cesium.Color.fromCssColorString('#7c8aa0');

/**
 * The commune outline's colour — COOL, and deliberately outside the hazard
 * ramp above.
 *
 * Every warm value on this layer means danger, graded. The boundary means
 * jurisdiction, which is not a grade of anything, and giving it an amber close
 * to `COLOR_ICPE` would read as "a large diffuse risk area" — the exact
 * misreading the stroke is here to avoid. Cyan is the product's own interface
 * hue: furniture, not finding.
 */
const COMMUNE_STROKE_CSS = '#6fd3e8';
/** Outline width in pixels. Wide enough to hold at the 12 km ceiling. */
const COMMUNE_STROKE_PX = 4;

/**
 * The wash inside the stroke, as an alpha on the SAME cyan.
 *
 * 0.18, the figure the address family already spends on a footprint it
 * annotates rather than replaces — `adsUrbanisme.js` fills an emprise at
 * exactly this, over a plot a hundred times smaller. A commune covers most of
 * the frame at the altitude this layer is read at, so the failure mode on this
 * side is not faintness but a FILTER: a wash that competes with the photograph
 * under it stops saying "these verdicts are about this ground" and starts
 * saying "this map is cyan".
 *
 * Composited against the reported view itself, over the band of woodland,
 * rooftops and road the complaint was written over: the step at the commune
 * line is already unmistakable at 0.16, 0.20 is indistinguishable from it, and
 * by 0.24 the greens of the orthophoto are visibly milky. 0.18 sits inside the
 * range where the step reads and the photograph does not pay for it.
 *
 * ONE VALUE, never ramped. See the module header: no composite score exists to
 * ramp it by, and counting hazards would invent one.
 */
export const COMMUNE_FILL_ALPHA = 0.18;

/** Refresh cadence. The register is republished in weeks, not minutes. */
const UPDATE_INTERVAL_MS = 300_000;
/** Radius asked of the API, in metres. */
const SCAN_RADIUS_M = 1000;

/**
 * Marker sizes, in CSS pixels at the near end of the distance ramp.
 *
 * Larger than the line-art mark they replace (26/20/15) because a plate can
 * afford it: the old triangle grew its bounding box without growing its ink,
 * so size bought nothing.
 *
 * RAISED AGAIN AFTER THE SECOND READING, from 30/24/18, and the near end is
 * the smaller half of the repair — the ramp below is the other. What these
 * numbers now buy, at the 5 859 m the complaint was written from
 * ({@link markPixelsAtDistance}): 34.0 px for a Seveso site, 28.9 for an
 * ordinary classified installation, 23.8 for a declassified one, against 15.9
 * before. The floor of the family is the declassified site, and it stays above
 * 22 px everywhere between a rooftop and the 12 km ceiling.
 *
 * THE COST IS OVERLAP, and it is the right way round. A dense industrial
 * quarter read from the ceiling now packs plates into each other; a reader who
 * needs one of them flies down, which is the gesture this whole layer is
 * built around. A mark nobody can find offers no such repair.
 */
const SIZE_SEVESO_PX = 40;
const SIZE_ICPE_PX = 34;
const SIZE_DECLASSIFIED_PX = 28;

/**
 * The distance ramp every installation mark rides.
 *
 * The layer goes dormant at 12 km, so this only has to cover the ground
 * between a rooftop and that ceiling — and the FAR END is what it spends
 * almost all of that on. Cesium interpolates against squared distance and
 * raises `t` to the power 0.2, so a mark is within a few percent of its far
 * value for most of the band: at 900 m the old ramp was already 38% of the way
 * down it. Reading `nearValue` as "the size this draws at" is the mistake this
 * ramp was written with, and {@link markPixelsAtDistance} is here so the next
 * change to it is made on a measured number.
 *
 * 400 m → 12 000 m, 1.0 → 0.8. The far distance now matches the dormancy
 * ceiling instead of stopping 3 km short of it, which means the mark reaches
 * its floor exactly where the layer switches off rather than three kilometres
 * early; and the floor is 0.8 rather than 0.6, which is where the eight
 * pixels the complaint was about actually went.
 */
const MARKER_SCALE = new Cesium.NearFarScalar(400, 1.0, 12_000, 0.8);

/**
 * What one mark ACTUALLY measures on screen, in CSS pixels, at a distance.
 *
 * Exported because it is the only honest way to talk about the size of these
 * marks: `SIZE_ICPE_PX` is the value at the near end of a curve that reaches
 * its far value almost immediately, and reading it as the size on screen is
 * what let a 15.9 px mark ship behind a constant that said 24. The harness
 * asserts on this, the unit tests pin it, and a future change to either
 * constant is measured rather than argued.
 *
 * `nearFarScalarValueAtDistance` is the fleet's own restatement of
 * `czm_nearFarScalar` — squared distance, then `pow(t, 0.2)` — and is shared
 * with the focus de-emphasis pass rather than copied here.
 *
 * @param {number} sizePx One of the three size constants.
 * @param {number} distanceM Camera distance to the mark, in metres.
 * @returns {number} CSS pixels, at a `resolutionScale` of 1.
 */
export function markPixelsAtDistance(sizePx, distanceM) {
  return sizePx * nearFarScalarValueAtDistance({
    near: MARKER_SCALE.near,
    nearValue: MARKER_SCALE.nearValue,
    far: MARKER_SCALE.far,
    farValue: MARKER_SCALE.farValue,
  }, distanceM);
}

/**
 * Colour and size one establishment by what it actually is.
 * @param {object} site
 * @returns {{color: object, sizePx: number}}
 */
function icpeStyle(site) {
  if (site.seveso) return { color: COLOR_SEVESO, sizePx: SIZE_SEVESO_PX };
  if (site.regime === 'Non ICPE') return { color: COLOR_DECLASSIFIED, sizePx: SIZE_DECLASSIFIED_PX };
  return { color: COLOR_ICPE, sizePx: SIZE_ICPE_PX };
}

/**
 * Which surface a ground-clamped stroke has to classify onto.
 *
 * The same test every zonal layer in the fleet makes, read from the shared
 * helper rather than copied a fourth time: a hidden globe means the
 * photorealistic tileset is the only surface left.
 *
 * @param {object|null|undefined} scene
 * @returns {number} A `Cesium.ClassificationType`.
 */
export function communeClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return surfaceFillDrapesBuildings(scene)
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/** Every hazard the scan resolved, natural and technological, in one list. */
export function allHazards(payload) {
  return [...(payload?.naturalRisks || []), ...(payload?.technologicalRisks || [])];
}

/**
 * The standing that describes the READER, with the commune's as the fallback.
 *
 * Address first because the reader is standing on an address. The commune's
 * verdict is the fallback and not the other way round: a hazard graded for the
 * commune and silent for the address is still something that reaches around
 * here, and dropping it would under-report.
 *
 * @param {object} hazard
 * @returns {?string}
 */
export function effectiveStanding(hazard) {
  return hazard?.addressStanding ?? hazard?.communeStanding ?? null;
}

/**
 * Which line of the key one hazard belongs on — exactly one, and never none.
 *
 * THE SILENT CASE IS THE COMMON ONE. A hazard the register checked and found
 * absent comes back `present: false` with BOTH verdicts null, so a classifier
 * that switches on the standing alone drops it from every bucket. Nine of the
 * eighteen hazards on the captured Paris 13e scan are exactly that, and they
 * are the entire population of the "checked, clear" tail line — without this,
 * that line counts one hazard instead of nine, or vanishes.
 *
 * `present: true` with no verdict either side is not observed upstream and is
 * routed to `unknown` rather than to the tail: an unexplained positive must
 * not be summarised as "nothing here".
 *
 * @param {object} hazard
 * @returns {'concerned'|'varying'|'unknown'|'settled'}
 */
export function legendBucket(hazard) {
  const standing = effectiveStanding(hazard);
  if (standing === 'concerned') return 'concerned';
  // Before `unknown`, so a hazard that is both keeps the label that says the
  // two verdicts disagree — which is the more actionable of the two facts.
  if (hazard?.variesByAddress) return 'varying';
  if (standing === 'unknown' || hazard?.present === true) return 'unknown';
  return 'settled';
}

/**
 * One hazard's line in the key: its name, its verdict, and the gap between the
 * two verdicts whenever there is one.
 *
 * The GRADE rides in the label rather than the sentence — "faible" and
 * "important" are the difference between a formality and a structural survey,
 * and a reader scanning eight lines should not have to read eight sentences to
 * find it.
 *
 * @param {object} hazard
 * @returns {{label: string, color: null, blurb: string}}
 */
export function hazardLegendEntry(hazard) {
  const standing = effectiveStanding(hazard);
  const verdict = standing === 'concerned'
    ? (hazard.grade ? `concerné · ${hazard.grade}` : 'concerné')
    : (standing === 'unknown' ? 'non connu' : 'hors zone');
  return {
    // THE DISAGREEMENT IS IN THE LABEL, not only in the sentence under it.
    // "Hors zone" alone, for a hazard the same register says reaches the
    // commune, is the one reading this layer exists to prevent: the reader
    // concludes the subject is settled when what the source said is "not on
    // your street, yes around here".
    label: `${hazard.label} — ${verdict}${hazard.variesByAddress ? ' · diffère de la commune' : ''}`,
    // Assessed, not mapped. The manager draws an empty aligned slot for this,
    // which is the honest swatch for a verdict with no geometry behind it.
    color: null,
    blurb: hazard.variesByAddress
      ? `commune : ${hazard.communeVerdict} · à cette adresse : ${hazard.addressVerdict}`
      : (hazard.detail || ''),
  };
}

/**
 * Whether an entity id is one of the commune WASH parts.
 *
 * A string test and not a lookup, because the question is asked from a click
 * handler in another layer, which holds no reference to this one's entities.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isCommuneWashId(id) {
  return typeof id === 'string' && id.startsWith('georisques:commune:') && id.includes(':wash:');
}

// THE WASH IS NOT AN OBJECT, and every sibling layer's click handler has to
// know it at the moment of the click. Declared at module scope — the predicate
// only matches ids that exist while this layer is drawing, so there is nothing
// to register on enable or tear down on disable.
registerPickDecoration('georisques', isCommuneWashId);

/**
 * Draw the commune HIGHLIGHT: one ground-classified wash per ring, behind the
 * stroke, in the stroke's own cyan.
 *
 * ── ANONYMOUS BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * No `name`, no `description`, no `properties`. That is the contract
 * `pickRegistry.registerPickDecoration` asks for and it is also the only
 * sensible reading: the card belongs to the commune, and it already hangs on
 * the outline and on the label, which are one shape and one word rather than
 * half the frame. A reader who clicks inside the commune is asking about the
 * ground they clicked, not about the administrative envelope around it — and
 * over on `urbanismeGpu.js` or `bruitFrance.js` that click is a question with
 * an answer.
 *
 * ── ONE COLOUR FOR EVERY PART, WHICH IS ALSO A CESIUM CONSTRAINT ────────────
 *
 * A commune keeps up to three pieces, and all of them carry the identical
 * colour. That is the honest cartography (the module header's argument) and it
 * is separately what keeps a batched `GroundPrimitive` correct: Cesium's
 * classification pass keeps the first instance whose AXIS-ALIGNED BOUNDING
 * RECTANGLE contains a pixel, not the first whose polygon does, so instances
 * in one batch with DIFFERENT colours repaint each other along rectangle
 * edges. `qa-cadastre-highlight.mjs` carries the measurement. Identical
 * colours make the bug unobservable; a per-part tint would resurrect it.
 *
 * ── THE CLOSING VERTEX IS DROPPED, AND A RING MAY NOT HAVE ONE ─────────────
 *
 * The mirror image of the stroke below, which has to close itself BY HAND
 * because `fromDegreesArray` draws exactly the vertices it is given. A polygon
 * hierarchy is closed by definition, so a repeated final vertex is a
 * degenerate edge; Cesium would discard it, and dropping it here means the
 * geometry handed over is the geometry meant rather than the geometry that
 * survives a dedupe pass.
 *
 * Tested rather than assumed on both sides: `projectCommuneContours` keeps the
 * source ring's closing vertex, and `decimateCommuneRing` can stride it away —
 * which is the very failure the stroke's hand-closing exists for. So the last
 * point is removed only when it actually repeats the first.
 *
 * @param {object} dataSource
 * @param {object} contour Projected commune from `communeContours.js`.
 * @param {number} classificationType
 * @returns {number} Rings washed.
 */
export function drawCommuneWash(dataSource, contour, classificationType) {
  const fill = Cesium.Color.fromCssColorString(COMMUNE_STROKE_CSS)
    .withAlpha(COMMUNE_FILL_ALPHA);
  let drawn = 0;
  for (const [index, flat] of (contour.parts || []).entries()) {
    // Eight numbers is four points, the smallest ring that encloses anything.
    // The same floor the stroke applies, for the same reason.
    if (!Array.isArray(flat) || flat.length < 8) continue;
    const closed = flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1];
    const ring = closed ? flat.slice(0, -2) : flat;
    if (ring.length < 8) continue;
    dataSource.entities.add({
      id: `georisques:commune:${contour.code}:wash:${index}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring)),
        material: fill,
        // Ground classification, which is what `classificationType` is read
        // for: no `height` and no `perPositionHeight` here, or Cesium builds
        // an ordinary primitive and then ignores the surface it was told to
        // land on — in silence, the way `franceEnergy.js` records for its
        // prisms.
        classificationType,
        // The stroke is the edge. An outline here would double it at a
        // slightly different width and read as a seam.
        outline: false,
      },
    });
    drawn += 1;
  }
  return drawn;
}

/**
 * Draw the commune outline, one polyline per ring, over its wash.
 *
 * THE EDGE, NOT THE SUBJECT, since {@link drawCommuneWash} arrived: what this
 * stroke now carries alone is the PRECISION of the boundary. A wash at alpha
 * 0.16 has a soft edge over a busy orthophoto, and the one thing a reader must
 * be able to see sharply is where the jurisdiction the verdicts belong to
 * actually ends.
 *
 * NOT PICKABLE, and that is a property of the technique rather than an
 * oversight: a `clampToGround` polyline is a ground primitive and `scene.pick`
 * returns null on it — measured in `urbanismeGpu.js` at every one of 62
 * vertices of a ring on screen. The commune's name is carried by the label
 * below, which is a billboard-class entity and does answer a click.
 *
 * @param {object} dataSource
 * @param {object} contour Projected commune from `communeContours.js`.
 * @param {number} classificationType
 * @param {string} description Card text shared with the label.
 * @returns {number} Rings drawn.
 */
export function drawCommuneOutline(dataSource, contour, classificationType, description) {
  const stroke = Cesium.Color.fromCssColorString(COMMUNE_STROKE_CSS).withAlpha(0.9);
  let drawn = 0;
  for (const [index, flat] of (contour.parts || []).entries()) {
    if (!Array.isArray(flat) || flat.length < 8) continue;
    const positions = Cesium.Cartesian3.fromDegreesArray(flat);
    dataSource.entities.add({
      id: `georisques:commune:${contour.code}:${index}`,
      name: contour.name,
      description,
      properties: { kind: 'commune-outline', code: contour.code },
      polyline: {
        // Closed by hand: `fromDegreesArray` draws exactly the vertices it is
        // given, and a decimated ring whose closing vertex was strided away
        // leaves a gash across the commune.
        positions: [...positions, positions[0]],
        width: COMMUNE_STROKE_PX,
        material: new Cesium.ColorMaterialProperty(stroke),
        clampToGround: true,
        classificationType,
      },
    });
    drawn += 1;
  }
  return drawn;
}

/**
 * The sentence the outline and its label both carry.
 * @param {object} payload
 * @param {object} contour
 * @returns {string}
 */
export function communeDescription(payload, contour) {
  const hazards = allHazards(payload);
  const concerned = hazards.filter((entry) => entry.communeStanding === 'concerned');
  const varying = hazards.filter((entry) => entry.variesByAddress);
  return [
    `Commune de ${contour.name} (${contour.code})`,
    concerned.length
      ? `${concerned.length} risque${concerned.length > 1 ? 's' : ''} recensé${concerned.length > 1 ? 's' : ''} sur la commune : `
        + concerned.map((entry) => entry.label).join(', ')
      : 'aucun risque recensé sur la commune',
    varying.length
      ? `${varying.length} verdict${varying.length > 1 ? 's' : ''} diffère${varying.length > 1 ? 'nt' : ''} entre la commune et l’adresse scannée`
      : null,
    // Said on the object itself, not only in the key: this shape is a legal
    // boundary that has been decimated to be drawable, and the one thing a
    // reader must not do with it is measure against it. It matters more now
    // that the boundary is FILLED: a wash reads as an area, and an area
    // invites being compared with the ground under its edge.
    contour.simplified
      ? 'contour simplifié pour l’affichage — ce n’est pas la limite cadastrale'
      : null,
    'Aucun de ces risques n’a d’emprise publiée : la surbrillance porte la commune, pas la zone exposée',
  ].filter(Boolean).join(' · ');
}

/**
 * The installation classes the key can print, in severity order.
 *
 * A class with no establishment in the scan is dropped rather than listed at
 * zero: a key that shows Seveso over a scan containing none teaches a reader
 * to hunt for a colour that is not on screen.
 */
const ICPE_LEGEND_CLASSES = Object.freeze([
  Object.freeze({
    test: (site) => site.seveso,
    label: 'Site Seveso',
    css: '#ff4d3d',
    blurb: 'Seuil haut ou bas — l\u2019établissement relève de la directive Seveso.',
  }),
  Object.freeze({
    test: (site) => !site.seveso && site.regime !== 'Non ICPE',
    label: 'Installation classée',
    css: '#ffa63d',
    blurb: 'Autorisation, enregistrement ou déclaration au titre des ICPE.',
  }),
  Object.freeze({
    test: (site) => site.regime === 'Non ICPE',
    label: 'Site déclassé',
    css: '#7c8aa0',
    blurb: 'Recensé puis sorti du régime ICPE — le registre le garde, la carte aussi.',
  }),
]);

/**
 * The on-map key.
 *
 * ORDER IS DRAWN-FIRST, THEN ASSESSED. A key explains a map, so the things
 * that are on screen come first with their colours; the verdicts follow,
 * unmapped, because they are the answer the map could not draw. Putting them
 * first would read as a list of layers that failed to render.
 *
 * A FUNCTION, not an inline config member, because the shell hands
 * `rowControls` THREE arguments — `(runtime, summary, payload)` — and a
 * one-parameter member that names its first `payload` silently reads the
 * runtime instead. Named and exported, it is exercised directly by
 * `georisques.test.mjs` against a captured scan.
 *
 * @param {?object} payload The drawn payload, or null while dormant.
 * @param {?object} summary `summarize()` of that payload, or null.
 * @returns {?object} Row controls, or null when there is nothing to key.
 */
export function georisquesLegend(payload, summary = null) {
  if (!payload) return null;
  const legend = [];

  const contour = payload.communeContour || null;
  if (contour) {
    legend.push({
      label: `Commune de ${contour.name}`,
      color: COMMUNE_STROKE_CSS,
      // WHAT THE TINT IS, AND WHAT IT IS NOT, in that order. The shape on
      // screen is now a filled commune, and a reader who has just read
      // "inondation — concerné" three lines below is one glance away from
      // taking the wash for the water.
      blurb: 'La surbrillance couvre la commune sur laquelle portent les '
        + 'verdicts ci-dessous — c\u2019est un périmètre administratif, pas '
        + 'l\u2019étendue d\u2019un risque, qu\u2019aucun de ces aléas ne publie.',
    });
  }

  // One line per class ACTUALLY DRAWN. A key that lists Seveso over a scan
  // with no Seveso site in it teaches the reader to look for a colour that is
  // not there.
  for (const klass of ICPE_LEGEND_CLASSES) {
    const count = (payload.icpe || []).filter(klass.test).length;
    if (!count) continue;
    legend.push({
      label: klass.label,
      color: klass.css,
      count,
      glyph: hazardPlateGlyph({ key: true }),
      blurb: klass.blurb,
    });
  }

  // The verdicts. Concerned first, then the ones that depend on the street,
  // then the ones the register declines to answer. A settled "no" is folded
  // into a single tail line, because six lines of it bury the two that say yes.
  //
  // A HAZARD WHOSE TWO VERDICTS DISAGREE KEEPS ITS OWN LINE EVEN WHEN THE
  // ADDRESS IS CLEAR, and that carve-out is the whole point of transporting
  // both verdicts. Without it, ICPE on the Paris 13e — "Risque Concerne" for
  // the commune, "Risque non Concerne" for the address — was folded into
  // "1 autres aléas vérifiés" and the reader lost the most informative line of
  // the scan.
  const hazards = allHazards(payload);
  const buckets = { concerned: [], varying: [], unknown: [], settled: [] };
  for (const hazard of hazards) buckets[legendBucket(hazard)].push(hazard);
  for (const hazard of [...buckets.concerned, ...buckets.varying, ...buckets.unknown]) {
    legend.push(hazardLegendEntry(hazard));
  }
  const clear = buckets.settled;
  if (clear.length) {
    legend.push({
      label: `${clear.length} autres aléas vérifiés — hors zone`,
      color: null,
      blurb: 'Contrôlés par le registre et sans objet à cette adresse — '
        + 'ce qui n\u2019est pas la même chose que non vérifiés.',
    });
  }

  // THE REGISTER OF HAZARDS NOT ANSWERING IS NOT THE SAME AS NO HAZARDS, and
  // without this line the two are identical on screen: a key listing the
  // outline and three classes of installation, and no verdict anywhere. A
  // reader would conclude the address is clear.
  //
  // Not hypothetical. Measured 2026-09-14: `resultats_rapport_risque` refused
  // every connection for the length of a session while `installations_classees`
  // and `radon` kept answering, so the layer drew a commune, 31 establishments
  // and silence where the flood verdict goes. The module header's own rule —
  // "a slow or unavailable source degrades one act, never the whole mission" —
  // only holds if the degraded act says so.
  if (payload.available && payload.available.report === false) {
    legend.push({
      label: 'Aléas indisponibles',
      color: null,
      blurb: 'Le registre des risques n’a pas répondu — inondation, argiles, '
        + 'sismicité et radon ne sont pas connus ici, ce qui n’est pas la même '
        + 'chose qu’absents. Les établissements ci-dessus, eux, sont à jour.',
    });
  }

  if (!legend.length) return null;
  return {
    legend,
    // DECLARED whenever a commune is washed, which is the condition
    // `drawCommuneWash` draws on. The shell mounts the shared drape sentence
    // from `surfaceFillNotice.js` only while the photorealistic mesh is the
    // classification surface — where the tint climbs the façades and the
    // tileset's own baked shading darkens it.
    surfaceFill: Boolean(contour),
    note: 'Les aléas n\u2019ont pas de géométrie chez Géorisques : ils sont dits, pas dessinés.',
    legendNote: summary?.commune
      ? `Géorisques — BRGM / MTE · ${summary.commune}${summary.radonClass ? ` · radon classe ${summary.radonClass}` : ''}`
      : 'Géorisques — BRGM / MTE',
  };
}

const georisquesLayer = createAddressScanLayer({
  id: 'georisques',
  name: 'Risques (Géorisques)',
  icon: '⚠',
  source: 'Géorisques — BRGM / MTE',
  endpoint: '/api/georisques',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M) }),
  // The outline reads its classification surface ONCE, when the primitive is
  // built, so a map-stack flip between the photorealistic mesh and a flat
  // basemap has to rebuild it. The four billboard-only address layers set this
  // false; `urbanismeGpu` sets it true for exactly this reason.
  redrawOnMapStack: true,

  render({ payload, dataSource, viewer }) {
    const classificationType = communeClassificationTypeForScene(viewer?.scene);
    const contour = payload.communeContour || null;
    if (contour) {
      const description = communeDescription(payload, contour);
      // The wash FIRST, so the ground primitives are batched in the order they
      // are read: the tint is the subject, the stroke is its edge. Cesium
      // draws a `GroundPolylinePrimitive` over a `GroundPrimitive` regardless,
      // which is the same stacking `urbanismeGpu.js` and `delinquanceFrance.js`
      // rely on for their own outlines.
      drawCommuneWash(dataSource, contour, classificationType);
      drawCommuneOutline(dataSource, contour, classificationType, description);
      // The name, written on the ground at the outline's centre. Without it the
      // stroke is an unexplained shape: the key names the commune, but a reader
      // following a line across a city has no way to tie the two together.
      const anchor = ringAnchor(contour.parts?.[0]);
      if (anchor) {
        dataSource.entities.add({
          id: `georisques:commune:${contour.code}:label`,
          position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
          name: contour.name,
          description,
          properties: { kind: 'commune-outline-label', code: contour.code },
          label: {
            text: contour.name.toUpperCase(),
            font: '600 12px "Roboto Mono", monospace',
            fillColor: Cesium.Color.fromCssColorString(COMMUNE_STROKE_CSS),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // FADE IN AS THE READER PULLS BACK, which is the inverse of the
            // usual ramp and is right here. The anchor is the centre of a
            // commune; from 500 m over one edge of it the label sits far
            // off-screen, and when it is on screen at that height it is a word
            // floating over an unrelated rooftop. It earns its place only once
            // enough of the outline is in frame to belong to.
            translucencyByDistance: new Cesium.NearFarScalar(1500, 0.0, 4500, 1.0),
          },
        });
      }
    }

    let drawn = 0;
    for (const site of payload.icpe || []) {
      if (!Number.isFinite(site.lon) || !Number.isFinite(site.lat)) continue;
      const { color, sizePx } = icpeStyle(site);
      dataSource.entities.add({
        id: `georisques:icpe:${site.id}`,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
        billboard: {
          // A FILLED HAZARD PLATE, not the line-art triangle this layer drew
          // until 2026-09-14. `hazardMarkerIcons.js` carries the measurement.
          // Severity stays in the colour and the size, as before.
          image: hazardPlateGlyph(),
          width: sizePx,
          height: sizePx,
          color,
          scaleByDistance: MARKER_SCALE,
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'icpe',
          regime: site.regime,
          seveso: site.seveso,
          distanceM: site.distanceM,
          updatedAt: site.updatedAt,
        },
        description: [
          site.address, site.commune,
          site.regime ? `Régime : ${site.regime}` : null,
          site.sevesoStatus ? `Seveso : ${site.sevesoStatus}` : null,
          site.distanceM !== null ? `${site.distanceM} m` : null,
        ].filter(Boolean).join(' · '),
        name: site.name,
      });
      drawn += 1;
    }
    // THE INSTALLATIONS, and not everything added above. The row's number is
    // read as "how many industrial sites are around me"; folding in an outline
    // and a place name would make it the count of Cesium entities, which is a
    // number about this program rather than about the address.
    return drawn;
  },

  rowControls: (_runtime, summary, payload) => georisquesLegend(payload, summary),

  summarize(payload) {
    const present = (list) => (list || []).filter((entry) => entry.present);
    const natural = present(payload.naturalRisks);
    const technological = present(payload.technologicalRisks);
    const hazards = allHazards(payload);
    return {
      commune: payload.commune?.name ?? null,
      // 75056 for any Paris arrondissement — echoed as the API gives it.
      communeInsee: payload.commune?.inseeCode ?? null,
      // The code the scan actually ran on: 75113 where the line above says
      // 75056. This is the one the outline and the radon class belong to.
      scanCommuneInsee: payload.commune?.scanInseeCode ?? null,
      naturalRisksPresent: natural.length,
      technologicalRisksPresent: technological.length,
      // The hazards whose verdict differs between the commune and the address:
      // the ones a reader should not generalise from.
      varyingByAddress: hazards.filter((entry) => entry.variesByAddress).map((entry) => entry.id),
      // What the key prints, counted: hazards that reach the reader, and
      // hazards the register looked at and could not resolve. Reported apart
      // because "unknown" is not a weaker "yes" — it is the absence of an
      // answer, and a reader deciding whether to commission a survey needs it
      // named.
      hazardsConcerned: hazards.filter((entry) => effectiveStanding(entry) === 'concerned').length,
      hazardsUnknown: hazards.filter((entry) => effectiveStanding(entry) === 'unknown').length,
      radonClass: payload.radon?.class ?? null,
      icpeTotal: payload.icpeTotal ?? null,
      icpeTruncated: payload.icpeTruncated === true,
      // Whether the commune outline is on screen, and whether it was decimated
      // to get there. Both travel because "no outline drawn" and "outline
      // drawn straighter than the legal boundary" are different claims.
      communeOutlined: Boolean(payload.communeContour),
      communeOutlineSimplified: payload.communeContour?.simplified === true,
      // Which of the four upstreams answered. "No industrial site nearby" and
      // "the ICPE endpoint did not reply" must never look the same.
      available: payload.available ?? null,
      sourceUrl: payload.sourceUrl ?? null,
    };
  },
});

export default georisquesLayer;
