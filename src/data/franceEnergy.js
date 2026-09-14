import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { greatCircleWaypoint } from './greatCircleArc.js';
import { mapIconGeometry } from './mapIcons.js';
import { screenProjectedRotation, stabilizeScreenRotation } from './iconOrientation.js';
import {
  dissolveRings,
  flattenRing,
  geometryRings,
  nearestRingVertex,
  ringArea,
  scaleRing,
} from './polygonDissolve.js';
import {
  PRISM_BASE_HEIGHT_M,
  PRISM_BODY_ALPHA,
  PRISM_HEIGHT_SWATCH_COLOR,
  PRISM_MAX_HEIGHT_M,
  PRISM_NO_RATIO_COLOR,
  PRISM_NO_RATIO_GLYPH,
  PRISM_TOP_ALPHA,
  createPrismScale,
  prismHeightGlyph,
  prismHeightM,
  prismRow,
  prismTally,
} from './choroplethPrism.js';

/**
 * éCO2mix — where French electricity actually comes from, right now.
 *
 * RTE publishes the national grid's state every 15 minutes: how much the
 * country is consuming, how much each generation filière is producing, the
 * carbon content of the kWh, and the commercial balance with each of the five
 * neighbouring markets. ODRÉ republishes it keyless under Licence Ouverte 2.0.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * Through the `/api/energy-fr` proxy, which merges `eco2mix-national-tr` and
 * `eco2mix-regional-tr` into one ~4 KB document. RTE's own API carries the
 * same figures behind an OAuth2 account; ODRÉ needs no credential, so this
 * layer works on `git clone`. The upstream's sign conventions and type traps
 * are absorbed in `eco2mixFeed.js`, under test against captured payloads.
 *
 * ── What is drawn, and why THAT ─────────────────────────────────────────────
 * The national figures are a scalar time series with no geometry — a gauge,
 * not a map. So the globe shows the two things in this dataset that ARE
 * spatial:
 *
 * 1. **Which regions power France, and which draw on it**, as a PRISM per
 *    région: HEIGHT is |MW| of physical exchange, HUE is the SIGN of it.
 *    Each region's `ech_physiques` is its consumption minus its generation, so
 *    its sign says whether it is a net exporter or a net importer. Measured
 *    2026-08-27 07:45Z: Auvergne-Rhône-Alpes −7 781 MW and Normandie −6 712 MW
 *    against Île-de-France +6 478 MW. That asymmetry — the capital importing
 *    almost its entire load from the nuclear and hydro regions — is the
 *    structural fact about the French grid, and the prism is what makes it one
 *    image instead of a table.
 *
 * 2. **The five border flows**, as ARROWS pointing the way the power is
 *    going — Maki's `arrow`, CC0, not a shape this file draws. Each one leaves
 *    the FRENCH FRONTIER rather than the middle of the country, and its depth
 *    is the megawatts. See the flow section below.
 *
 * 3. **The five neighbouring market areas**, as OUTLINES. Never filled — see
 *    the honesty rules below.
 *
 * ── Why the flat fill had to go, and what replaced which channel ────────────
 *
 * This layer used to paint the régions in two flat colours whose ALPHA ramped
 * with |balance| / load. That is the fault CARTOGRAPHIE B1 names in capitals:
 * `ech_physiques` is an ABSOLUTE quantity in megawatts, and « Représentation
 * d'une variable quantitative absolue en aplats de couleur — NOP !!!! ». A
 * colour fill can carry a rate; it cannot carry 7 781 MW.
 *
 * A3 — what each channel carried, and what it carries now:
 *
 *   HEIGHT  before: nothing. On a 3D globe, the axis was empty.
 *           now:    |MW|, linearly, from a common datum. The absolute
 *                   quantity finally sits on the one channel B1 allows it.
 *   HUE     before: the sign, plus (through alpha) a smear of the magnitude.
 *           now:    the SIGN ALONE — two franc hues, no gradient. The sign is
 *                   a BINARY QUALITATIVE fact, and B4 is explicit that colour
 *                   « est uniquement différenciatrice […] L'œil ne peut pas
 *                   établir d'ordre ». A diverging ramp would have invited the
 *                   eye to rank −7 781 against +6 478 by shade; the height
 *                   ranks them, and it ranks them correctly.
 *   ALPHA   before: |balance| / load, ramped 0.12 → 0.52 against a saturation
 *                   of 1.5. A second magnitude encoding on top of the hue —
 *                   A3 twice over, and unreadable on a translucent volume seen
 *                   through another translucent volume.
 *           now:    CONSTANT (`PRISM_BODY_ALPHA` / `PRISM_TOP_ALPHA`). The
 *                   ratio it carried is not lost: it is published in the
 *                   analyst record as `exchangeRatio`, where a number belongs.
 *
 * ── The arbitration: both prisms go UP ──────────────────────────────────────
 *
 * A signed quantity invites the obvious figure — export UP, import DOWN, the
 * globe's surface as the zero line. It is semiologically stronger on paper and
 * it is not drawable here. Three reasons, in order of weight:
 *
 * 1. It would be INVISIBLE, not merely awkward. `Globe.translucency.enabled`
 *    is false by default (`Build/CesiumUnminified/index.js:208871`) and it is
 *    a scene-wide property no layer owns; with an opaque globe, a prism under
 *    the ellipsoid is occluded ENTIRELY, not partially. Terrain makes it
 *    worse: the ground sits above the ellipsoid nearly everywhere on land, so
 *    an Île-de-France prism going down would be buried before it started. And
 *    on the photorealistic stack the globe is hidden and the 3D tileset is the
 *    surface (`main.js:237`), which occludes just the same.
 * 2. Even if it rendered, the two halves would not be COMPARABLE. A signed bar
 *    chart works because its zero line is straight; here the datum is a
 *    sphere. Reading 7 781 MW up in Auvergne against 6 478 MW down in
 *    Île-de-France means comparing two lengths on opposite sides of a curved,
 *    foreshortened limb — the exact measurement the prism exists to make easy.
 * 3. The direction is already carried, losslessly, by the one variable
 *    perspective does not distort (F4): the hue. Spending geometry on a fact
 *    the colour states exactly, in order to lose the magnitude comparison, is
 *    a bad trade. The height ruler stays single and shared: every prism starts
 *    at `PRISM_BASE_HEIGHT_M` = 0 and grows the same way, so the tops are
 *    comparable across all twelve régions, and the pair of hues says which way
 *    the power flows.
 *
 * What this costs, plainly: the picture no longer looks like a balance sheet,
 * and a reader who ignores colour sees only "who moves the most power". The
 * label at the top of every prism spells the verb (EXPORTE / IMPORTE) and the
 * megawatts, so colour is never the sole carrier.
 *
 * ── One mark per measurement: the dissolve ─────────────────────────────────
 *
 * This layer measures TWELVE régions. It used to draw NINETY-SIX prisms.
 *
 * The old note here argued that the seams between the eight départements of
 * Île-de-France were « the truth of the geometry, not twelve readings ». That
 * was true about the polygons and false about the picture, and the first
 * person to look at the layer proved it in one sentence: « chaque département
 * a une hauteur qui est représentative du niveau de puissance qu'il exporte
 * […] on n'arrive pas à distinguer un département par rapport à un autre » —
 * a reading of DEPARTMENTAL measurements, on a map where no département is
 * measured, followed by the complaint that they all look the same. They looked
 * the same because they ARE the same. Ninety-six marks for twelve readings is
 * A1 at the level of the mark itself: the unit the eye counts has to be the
 * unit that was measured.
 *
 * So the départements are dissolved into their région before anything is
 * drawn (`polygonDissolve.js`), and each région gets ONE mark. Measured on the
 * bundled file: **96 polygons, 118 rings and 14 335 vertices** became **13
 * marks** — twelve prisms and Corse — because **4 253 shared segments**
 * cancelled, leaving 31 rings and 5 742 vertices in all. Île-de-France alone
 * cancelled 139 of them.
 *
 * Two consequences are stated rather than hidden:
 *
 * • **Islands under {@link PRISM_MIN_RING_AREA_DEG2} carry no prism.** Ré,
 *   Oléron, Belle-Île, Noirmoutier, Yeu, Porquerolles. A 78 km column standing
 *   on a 23 km² island is a needle that measures its région and looks like it
 *   measures the island. They keep their outline on the ground and lose the
 *   volume. Corse is far above the threshold and is unaffected — its absence
 *   from the map is a data fact, not a geometric one.
 * • **The prism does not stand on the whole région.** See the next section.
 *
 * ── Why the footprint is pulled in, and what pays for it ────────────────────
 *
 * Twelve dissolved régions tile France with no gap. Extruded, at any oblique
 * angle, they compose into a single continuous mesa: the near ones occlude the
 * far ones, and where two neighbours run at similar heights the eye reads one
 * plateau across a border it cannot see. Twelve marks that touch are not
 * twelve marks.
 *
 * The prism therefore stands on the région's footprint scaled to
 * {@link PRISM_FOOTPRINT_SCALE} about its own centroid, which opens a canyon
 * between every pair of neighbours. Measured, mean pull-back per région: 6.3 km
 * for Île-de-France, 17.2 km for Nouvelle-Aquitaine, 5.8 km for Corse — so a
 * canyon of 12 to 34 km between two neighbours, ~24 px at the ~1 500 km
 * national altitude this layer's calibration section uses. Each volume becomes
 * an object with a silhouette on both sides.
 *
 * A uniform scale, not an inward buffer, and the reason is in
 * `polygonDissolve.js`: a buffer self-intersects wherever a shape is narrower
 * than twice the offset (the Cotentin, the Gironde, the Alpine valleys) and a
 * scale about an interior point cannot self-intersect at all.
 *
 * What it costs, plainly: **the base of a prism is no longer exactly where the
 * région ends.** That is a real loss and it is paid for, not waved away — the
 * TRUE perimeter of every région is drawn as a line clamped to the ground,
 * under the prism it belongs to, in the same colour. The reader who wants to
 * know where Normandie stops looks at the line, which is exact; the reader who
 * wants to compare two heights looks at the volumes, which no longer merge.
 * The legend used to say both in French; it says two rows now, and
 * {@link energyPrismLegend} records what that deliberately stopped telling
 * anyone.
 *
 * ── The flow is a ready-made arrow, and its length is not a variable ───────
 *
 * Two drawings came before this one and both were this file's own. The first
 * was a Cesium `PolylineArrowMaterialProperty`, a tapering stroke 3 to 10
 * SCREEN PIXELS wide: 366 MW from Spain came out at 3.85 px next to a 78 km
 * prism, and the reader's verdict was « quasi illisible […] vraiment quelque
 * chose de ridicule ». The second was a tube swept along a great circle and
 * terminated by a cone, in metres this time — and the same reader's verdict on
 * it was « moches ».
 *
 * They were right twice, and the second time it was not the size. An eight-
 * sided `polylineVolume` with `outline: true` draws its eight longitudinal
 * edges, so 340 km of shaft read as corrugated hose; and a cone is a triangle
 * only from side-on, which is one of the camera pitches this layer is read at.
 *
 * The mark is now **Maki's `arrow`** — CC0, authored for maps, vendored path-
 * verbatim in `mapIcons.js` — drawn as ONE billboard. The constants section
 * around {@link ARROW_LENGTH_M} carries the arithmetic; the three things worth
 * knowing here are:
 *
 * • **It wears the prism's clothes, not the icon packs'.** Every other
 *   billboard in this project is white line-art over a black halo. This one is
 *   a translucent body at {@link PRISM_BODY_ALPHA} under a near-opaque edge at
 *   {@link PRISM_TOP_ALPHA} — the same two numbers, imported and not retyped,
 *   that the prism and the région perimeter already use. Asked for in those
 *   words: « réutilise cet effet de transparence qui est appliqué sur le
 *   traçage des formes des régions ». {@link borderArrowGlyph} builds it.
 *
 * • **A screen width still fights the rest of the layer**, and the arrow does
 *   not use one: `sizeInMeters` puts it in metres like every prism. Its depth
 *   ramps with |MW| and saturates at the same 3 000 MW the pixel stroke used.
 *   At the 1.21 km/px of the reference altitude the shaft runs 15 px to 29 px
 *   and the head 80 px to 161 px, against 3.85 px.
 *
 * • **Length is one constant for all five, and the arrow STRADDLES its
 *   frontier.** The tube clamped length to `[170 km, 340 km]`, which left a
 *   2:1 ratio between Switzerland and Spain that the data never wrote. Every
 *   arrow is now 300 km: 190 km abroad and 110 km back into France. Both
 *   halves are measured ceilings and both are recorded at
 *   {@link ARROW_ABROAD_M} — the first is what keeps each far end inside the
 *   market it names, the second is what keeps the Swiss and German arrows from
 *   fusing into one orange knot over Grand Est.
 *
 * • **Sense survives the camera.** A billboard faces the viewer, and its
 *   course is re-projected every frame by `iconOrientation.js` — the module
 *   the flight and AIS layers already trust for exactly this. The arrow is the
 *   same arrow from overhead and from a shallow oblique. The cone carried the
 *   sense and was the first thing the camera took away.
 *
 * **The bow is gone, and with it an F7(b) exemption this file used to have to
 * argue for.** The tube rose 20–55 km because a tube lying on the ground
 * buries its own lower half, and that height sat inside the prism ruler's own
 * amplitude. A billboard has no lower half: it rides at one constant altitude
 * that ramps with nothing and means nothing.
 *
 * ── The neighbours are delimited, and never filled ──────────────────────────
 *
 * `ech_comm_espagne` is 500 MW and a country name. Until now the country
 * itself was nowhere on the globe: an arrow pointed off the frame and the
 * reader supplied Spain from memory. The five market areas are now outlined
 * from `local_data/energy_market_areas/` (Natural Earth, public domain,
 * 674 points for the five).
 *
 * They are drawn as a LINE and the inside is left empty, deliberately, and it
 * is the same rule as everywhere else in this layer: a filled polygon is what
 * a MEASUREMENT looks like here, and nothing inside Spain was measured. The
 * three marks are therefore three claims —
 *
 *     prism, filled            → measured, and this tall
 *     flat footprint, striped  → known, and not published (Corse)
 *     outline, empty           → this is the counterparty, and it is all we
 *                                know about it
 *
 * — and the outline takes the flow's colour, so a market France is exporting
 * to is teal on the arc AND on its own border. A market whose flow is under
 * the deadband is drawn slate: still a neighbour, nothing crossing.
 *
 * Two honesty notes travel with the file and are repeated in its `SOURCE.md`:
 * the Spanish outline is the peninsular MARKET, so the Balearics and the
 * Canaries are absent; the British one is the GB bidding zone, so Northern
 * Ireland is absent. Germany and Belgium share one outline because they share
 * one field.
 *
 * ── Calibration, frozen (C1) ────────────────────────────────────────────────
 *
 * `ENERGY_PRISM_DOMAIN_MAX_MW` = 12 000 MW ↔ 120 km, a literal measured once
 * and published here, never re-derived from the poll in hand. On the captured
 * snapshot the twelve régions run 7 781 → 1 544 MW, i.e. a dynamic range of
 * 1 : 5.0 — far under the 1 : 30 where `choroplethPrism` says a square-root
 * ruler starts earning its keep — and the smallest of them stands at 15.4 km,
 * 3.9× the 4 km floor. So `'linear'` here is not a default taken on trust: no
 * région is floored, and « deux fois plus haut vaut deux fois plus » is true
 * of every pair on the map.
 *
 * At the ~1 500 km national altitude (`prismApparentPx`, 1600 × 1000):
 *
 *     Auvergne-Rhône-Alpes  7 781 MW → 77.8 km →  74.9 px
 *     Normandie             6 712 MW → 67.1 km →  64.6 px
 *     Île-de-France         6 478 MW → 64.8 km →  62.3 px
 *     Bretagne              1 544 MW → 15.4 km →  14.9 px
 *
 * The headroom is deliberate. Setting the domain at the observed maximum would
 * clip the leader on the first cold day: Auvergne-Rhône-Alpes alone carries
 * ~13.5 GW of nuclear plus the Rhône hydro chain against a ~6.5 GW load, and
 * Normandie ~10.4 GW against ~2.6 GW. 12 000 MW sits above the largest balance
 * that fleet can produce while still spending 65 % of the ruler on the régions
 * that exist. A value above it is CLIPPED and counted in `getStats()` rather
 * than silently rescaling the whole country. It used to be declared in the
 * legend too (A5); the legend is two rows now, by instruction, and
 * {@link energyPrismLegend} carries the list of what that cost.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **The régions are painted, and the DÉPARTEMENTS are only the source.**
 *   There are no bundled région polygons; the 96 département shapes already
 *   carried for Vigilance are grouped by région and DISSOLVED into one outline
 *   apiece before anything is drawn. No département survives into the scene,
 *   no label ever names one — a prism looks far more like a measured unit than
 *   a flat fill ever did, and the unit has to be the one that was measured.
 *   See the dissolve section above.
 *
 * • **Corse gets a sign of its own, and it is not a short prism.** éCO2mix
 *   régional covers 12 metropolitan regions; Corsica runs on its own system
 *   and is absent upstream. 2A and 2B are therefore drawn FLAT AND STRIPED —
 *   a motif, not a tint, because on a photorealistic globe no hue is neutral
 *   and a pattern is what survives the NVG and FLIR passes (D3). Under the old
 *   flat regime they were simply hidden, which made "not published" look
 *   exactly like "nothing here"; a prism regime cannot afford that, because a
 *   missing prism and a zero-height prism are one pixel apart. The three
 *   states are now distinct marks (A1): striped flat footprint = unmeasured,
 *   opaque flat footprint = measured at zero, prism ≥ 4 km = measured.
 *
 * • **Only the flat marks are ground-classified.** An extruded polygon does
 *   not classify: `GroundGeometryUpdater._isOnTerrain` returns false as soon
 *   as `extrudedHeight` is defined (`index.js:148334-148336`), so
 *   `polygon.classificationType` would be read and then ignored in silence.
 *   The map-stack listener therefore still runs — the striped footprint, the
 *   measured-zero footprint, the région perimeters and the market outlines ARE
 *   clamped, and they still have to drape on whichever surface is active — but
 *   it skips every prism instead of pretending. Two things
 *   come free with the change: the batched-`GroundPrimitive` bug that colours
 *   an instance by its bounding rectangle cannot apply to a geometry that
 *   classifies nothing; and the outline Cesium force-disables on terrain
 *   (`index.js:61110-61113`) becomes legal, which is what draws the top edge
 *   the height is read against. `surfaceFill` is consequently false: no
 *   thematic hue climbs a façade here any more (F4).
 *
 * • **An unmeasured région is NAMED, not just striped.** Three things put a
 *   région in that state — Corse, which is never published; a published null;
 *   and a région the feed drops for a poll, which happens because éCO2mix
 *   publishes per-région and keeps the newest row each has. All three get the
 *   same mark, so all three get the same count, and that count is taken from
 *   the THIRTEEN known régions rather than from the rows the payload carried.
 *   Counting the rows is what let Normandie vanish on the 2026-09-10 15:04Z
 *   poll: twelve prisms, two striped shapes, and a legend that said « non
 *   publié 1 ». The label is the other half — an anonymous grey shape made the
 *   reader work out which région was missing from the coastline.
 *
 * • **A zero flow is drawn as nothing.** A border at 0 MW is not a thin arc,
 *   it is no arc — the same "absence is not a colour" rule the Vigilance layer
 *   established for level vert.
 *
 * • **The arcs leave the frontier, and they are still not cables.** They used
 *   to start at a single point in the middle of France — all five of them,
 *   from Berry, which drew a country that trades out of its own centre of
 *   gravity. Each arc now leaves the point of the FRENCH FRONTIER nearest its
 *   market's reference point, computed from the same dissolved geometry
 *   (`frontierAnchors`), and runs a fixed 175 km on that BEARING — it aims at
 *   the reference point and does not travel to it. Measured, with Corsica
 *   excluded from the search so
 *   the Italian arc does not leave from Bonifacio: Angleterre 1.58 E / 50.87 N
 *   (Gris-Nez), Espagne 1.44 W / 43.05 N (Pays basque), Italie 7.71 E /
 *   44.07 N (Alpes-Maritimes), Suisse 7.42 E / 47.45 N (Sundgau),
 *   Allemagne + Belgique 6.47 E / 49.46 N (Moselle).
 *
 *   That those five land where real interconnections land is a consequence and
 *   NOT a claim: `ech_comm_*` is a commercial nomination between two market
 *   areas and carries no routing at all. The frontier point is a geometric
 *   fact about a border, the far end is a BEARING toward a reference point
 *   inside a country, and neither is a converter station.
 *   `ech_comm_allemagne_belgique` is one field for two countries and stays one
 *   arc, labelled with both.
 *
 * • **Commercial ≠ physical.** The five commercial balances do not sum to
 *   `ech_physiques` (measured: −2 893 against −3 633 MW). The arcs show the
 *   commercial figures and say so; the national net shown in `getStats()` is
 *   the physical one and is labelled separately.
 *
 * • **Carbon intensity is national only.** RTE publishes no regional CO₂
 *   content, so none is painted per region — only reported for France.
 */

const API_URL = '/api/energy-fr';
const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;
const MARKET_AREAS_URL = new URL(
  './local_data/energy_market_areas/market_areas.geojson',
  import.meta.url,
).href;

/** Shared world-overlay source id (matches the layer id). */
export const ENERGY_OVERLAY_SOURCE_ID = 'france-energy';
/** Bounded label cohort offered to the shared overlay host: 13 régions + 5 borders. */
export const ENERGY_OVERLAY_COHORT_LIMIT = 20;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const ENERGY_OVERLAY_COLLISION_CAPACITY = 18;

/**
 * Idle refresh cadence. The proxy holds a 4-minute cache in front of ODRÉ and
 * the product itself steps every 15 minutes, so polling faster than this buys
 * nothing; polling slower would let a cached document age past its own step.
 */
const UPDATE_INTERVAL_MS = 180_000;

/**
 * Région INSEE code → the département codes it contains (2016 boundaries,
 * which are the ones `code_insee_region` uses).
 *
 * Corse (94, départements 2A/2B) is present so the join can state that it is
 * KNOWN and deliberately unpainted, rather than silently missing — éCO2mix
 * régional publishes no Corsican row. The DOM regions are absent because the
 * bundled polygons are metropolitan only.
 */
export const REGION_DEPARTEMENTS = Object.freeze({
  11: Object.freeze(['75', '77', '78', '91', '92', '93', '94', '95']),
  24: Object.freeze(['18', '28', '36', '37', '41', '45']),
  27: Object.freeze(['21', '25', '39', '58', '70', '71', '89', '90']),
  28: Object.freeze(['14', '27', '50', '61', '76']),
  32: Object.freeze(['02', '59', '60', '62', '80']),
  44: Object.freeze(['08', '10', '51', '52', '54', '55', '57', '67', '68', '88']),
  52: Object.freeze(['44', '49', '53', '72', '85']),
  53: Object.freeze(['22', '29', '35', '56']),
  75: Object.freeze(['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87']),
  76: Object.freeze(['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82']),
  84: Object.freeze(['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74']),
  93: Object.freeze(['04', '05', '06', '13', '83', '84']),
  94: Object.freeze(['2A', '2B']),
});

/** Régions the upstream dataset does not cover — never given a prism. See header. */
export const UNCOVERED_REGIONS = Object.freeze(['94']);

/**
 * Région INSEE code → its name, for the régions the payload does NOT carry.
 *
 * Every measured région is named by éCO2mix itself and this table is never
 * consulted for it. It exists for the two cases where the upstream says
 * nothing at all and the map still has to: Corse, permanently, and any région
 * the feed drops for a poll. Before it existed, a dropped région was drawn
 * striped and left ANONYMOUS — the first reader hit exactly that and had to
 * ask, « pourquoi j'ai l'impression qu'une des régions n'est pas dessinée, on
 * n'a pas l'information, c'est ça ? ». The answer was yes, and a map that
 * needs a reader to guess it is the A1 fault this layer is built to avoid.
 *
 * 2016 boundaries, matching `code_insee_region` and {@link REGION_DEPARTEMENTS}.
 */
export const REGION_NAMES = Object.freeze({
  11: 'Île-de-France',
  24: 'Centre-Val de Loire',
  27: 'Bourgogne-Franche-Comté',
  28: 'Normandie',
  32: 'Hauts-de-France',
  44: 'Grand Est',
  52: 'Pays de la Loire',
  53: 'Bretagne',
  75: 'Nouvelle-Aquitaine',
  76: 'Occitanie',
  84: 'Auvergne-Rhône-Alpes',
  // Straight apostrophe, against this repo's own prose habit, because these
  // strings are DATA and not prose: éCO2mix spells it `d'Azur`, and a région
  // that changed its apostrophe the moment the feed dropped it would be one
  // more thing for a reader to wonder about. Pinned by test.
  93: "Provence-Alpes-Côte d'Azur",
  94: 'Corse',
});


/**
 * The balance palette — three NOMINAL classes, no ramp between them.
 *
 * Teal for surplus and amber for deficit, chosen to survive the deuteranopia
 * collision that a red/green pair would walk straight into. Colour is never
 * the only carrier: every label states the verb (EXPORTE / IMPORTE) and the
 * megawatts in words.
 *
 * `balanced` exists so that a measured near-zero has a colour of its own. The
 * sign of a 0.3 MW balance is rounding, not a direction, and painting it teal
 * or amber would assert a flow nobody measured. It is drawn slate, and on the
 * captured snapshot it never fires — the smallest real balance is 1 544 MW.
 */
export const BALANCE_STYLES = Object.freeze({
  exporter: Object.freeze({
    key: 'exporter', verb: 'EXPORTE', color: '#2ee6a8', label: 'Excédentaire',
    blurb: 'Produit plus qu’elle ne consomme',
  }),
  balanced: Object.freeze({
    key: 'balanced', verb: 'ÉQUILIBRÉE', color: '#8fa3b8', label: 'Équilibrée',
    blurb: 'Produit ce qu’elle consomme, à moins d’un mégawatt près',
  }),
  importer: Object.freeze({
    key: 'importer', verb: 'IMPORTE', color: '#ff9b3d', label: 'Déficitaire',
    blurb: 'Consomme plus qu’elle ne produit',
  }),
});

/**
 * Below this many megawatts a balance has no direction worth painting.
 *
 * It no longer means "drawn as nothing": that conflated a measured zero with
 * an unpublished région, which is the A1 fault this layer used to carry. Under
 * the deadband the prism keeps its measured height (the 4 km floor at least)
 * and takes the slate `balanced` colour; only an EXACT zero collapses to a
 * flat footprint. A border arc still disappears below the deadband — an arc is
 * a direction, and a direction of nothing is nothing.
 */
export const BALANCE_DEADBAND_MW = 1;

/**
 * Top of the frozen height domain, in megawatts. See the calibration section
 * of the header: 12 000 MW ↔ `PRISM_MAX_HEIGHT_M`, measured once, published
 * here, and never re-derived from a poll (C1).
 */
export const ENERGY_PRISM_DOMAIN_MAX_MW = 12_000;

/**
 * The layer's frozen prism scale.
 *
 * `ratio` here is the SIGNED balance in MW and the two breaks are the deadband
 * edges, so the three colour classes are exporter / balanced / importer. That
 * is a nominal ladder riding on `choroplethPrism`'s numeric binning, and it is
 * the honest use of the machinery: the colour answers "which way", never "how
 * much". "How much" is the height, and it is |MW|.
 */
export const ENERGY_PRISM_SCALE = createPrismScale({
  id: 'france-energy',
  domainMax: ENERGY_PRISM_DOMAIN_MAX_MW,
  heightLabel: 'solde d’échange physique',
  heightUnit: 'MW',
  mode: 'linear',
  heightTicks: [10_000, 5_000, 1_000],
  ratioLabel: 'sens de l’échange',
  ratioBreaks: [-BALANCE_DEADBAND_MW, BALANCE_DEADBAND_MW],
  ratioColors: [
    BALANCE_STYLES.exporter.color,
    BALANCE_STYLES.balanced.color,
    BALANCE_STYLES.importer.color,
  ],
  ratioClassLabels: [
    `${BALANCE_STYLES.exporter.label} — exporte`,
    `${BALANCE_STYLES.balanced.label} — sous ${BALANCE_DEADBAND_MW} MW`,
    `${BALANCE_STYLES.importer.label} — importe`,
  ],
});

/**
 * Reference points for the border arcs — NOT interconnection sites.
 * See the header: `ech_comm_*` is a market-area balance, and anchoring it at a
 * converter station would claim a routing precision the field does not carry.
 *
 * `france` is the FALLBACK end only. It is used when the bundled département
 * geometry has not loaded, so an arc still draws rather than vanishing; every
 * normal frame replaces it with the frontier point {@link frontierAnchors}
 * computes for that market.
 */
export const BORDER_ANCHORS = Object.freeze({
  france: Object.freeze([2.60, 46.60]),
  angleterre: Object.freeze([-1.55, 52.60]),
  espagne: Object.freeze([-3.70, 40.42]),
  italie: Object.freeze([12.50, 42.80]),
  suisse: Object.freeze([8.23, 46.80]),
  // One point standing in for the field's two countries, placed between the
  // Belgian border and western Germany so it favours neither.
  allemagne_belgique: Object.freeze([7.20, 50.40]),
});

/**
 * The border flow is a READY-MADE ARROW, not a shape this file builds.
 *
 * It was, in order: a `PolylineArrowMaterialProperty` 3.85 px wide, which the
 * first reader called « quasi illisible […] vraiment quelque chose de
 * ridicule »; then a tube swept along a great circle and terminated by a cone,
 * which the same reader called « moches ». The second verdict is the one worth
 * reading carefully, because the geometry was correct and it still looked
 * wrong:
 *
 * • **An eight-sided `polylineVolume` with `outline: true` draws its eight
 *   longitudinal edges.** Over 340 km of bowed tube that is eight parallel
 *   stripes running the length of the mark — the silhouette the outline was
 *   there to protect became corrugated hose.
 * • **A cone is a blob from every angle but one.** Seen side-on it is a
 *   triangle; seen at any other camera pitch it is an ellipse with a bump, and
 *   the layer draws at every camera pitch.
 *
 * The mark is now Maki's `arrow`, CC0, vendored in `mapIcons.js` and drawn as a
 * single billboard. Nothing here draws an arrow any more, which is the point:
 * the artwork was authored for maps by people who draw arrows, and this file
 * was inventing one out of primitives that happen to exist in Cesium.
 *
 * ── What the billboard buys, beyond looking like an arrow ───────────────────
 *
 * **Sense survives the camera.** A billboard faces the viewer, and
 * {@link borderArrowRotation} re-projects the flow's course every frame
 * through `iconOrientation.js`. The cone was the mark that carried the sense
 * and it was the first thing lost when the camera dropped.
 *
 * **The bow is gone, and with it an F7(b) exemption.** The old glyph rose 20 to
 * 55 km because a tube sitting on the ground buries its own lower half; that
 * height was inside the prism ruler's amplitude and had to be argued for in the
 * legend. A billboard has no lower half. It rides at a single constant
 * {@link ARROW_ALTITUDE_M} and measures nothing at all.
 *
 * ── One length for all five, at last ────────────────────────────────────────
 *
 * Length has never been a variable this layer wrote, and it is now not a
 * variable at all. The previous glyph clamped it to `[170 km, 340 km]`, which
 * left a 2:1 ratio between the Swiss mark and the Spanish one that no reader
 * could be blamed for reading as data.
 *
 * {@link ARROW_LENGTH_M} is a single constant, and 175 km is not a round
 * number picked by eye — it is the largest one that keeps every flow pointing
 * at its own market. Measured against the bundled outlines, from each market's
 * frontier point along the great circle to its reference point:
 *
 *     suisse              the reference point is 94 km away; the glyph is
 *                         still inside Switzerland at 175 km and leaves it at
 *                         ~195 km. THIS is the binding constraint.
 *     allemagne_belgique  117 km away, inside at 175 km.
 *     angleterre          289 km away, inside.
 *     espagne             347 km away, inside.
 *     italie              411 km away, and the one that is NOT inside: the
 *                         great circle from the Alpine frontier to central
 *                         Italy crosses the Ligurian Sea, so at 175 km the
 *                         glyph is over water off Genoa. It is on the exact
 *                         bearing of its market, it is four times nearer the
 *                         Italian reference point than any other, and the
 *                         Italian outline is drawn in its colour. Stated here
 *                         rather than fixed by lengthening the glyph, which
 *                         would only move the problem onto Switzerland.
 *
 * ── Thickness is still the only thing the data moves ────────────────────────
 *
 * The billboard is scaled ANISOTROPICALLY: {@link ARROW_LENGTH_M} across, and
 * a depth that ramps with |MW| and saturates at {@link ARC_SATURATION_MW}.
 * Scaling a rectangle in image space is rigid — the rotation is applied to the
 * quad's corners, not to the texture — so the head keeps its 5.6:1 ratio to the
 * shaft at every flow. What changes is the arrow's ASPECT: a weak border draws
 * a long thin arrow, a saturated one draws the artwork at its own proportions.
 *
 * {@link ARROW_DEPTH_MAX_M} is deliberately equal to {@link ARROW_LENGTH_M}, so
 * the strongest flow on the map is the only one drawn undistorted. Anything
 * above it would stretch Maki's arrow TALLER than it is long, which is the one
 * direction that stops looking like an arrow.
 *
 * What that is worth, at the 1.21 km/px of the reference altitude: the shaft
 * runs 10.6 km to 20.6 km, which is 9 px to 17 px, and the head 58 km to
 * 113 km, 48 px to 94 px. Against 3.85 px.
 */
const ARC_SATURATION_MW = 3000;
/**
 * How far the glyph reaches ABROAD from its frontier point, and how far back
 * INTO France. Their sum is the length, identical for all five borders.
 *
 * Both halves are measured ceilings, not preferences:
 *
 * • **190 km abroad** is the largest reach that keeps every arrow's far end
 *   inside the market it names. Switzerland binds it — its reference point is
 *   94 km from the frontier and the glyph leaves Swiss territory at ~200 km.
 *   (Italy is the one that never lands inside: the great circle from the
 *   Alpine frontier to central Italy crosses the Ligurian Sea, so the far end
 *   is over water off Genoa at any length. It is still four times nearer the
 *   Italian reference point than any other, and Italy is outlined in its
 *   colour.)
 *
 * • **110 km inland** is the largest reach that keeps the Swiss and the
 *   Allemagne + Belgique arrows apart. Their frontier points are 234 km from
 *   each other and their inland bearings CONVERGE — at 190 km inland the two
 *   ends are 94 km apart and, with heads 200 km deep, the two marks overlap
 *   into one orange knot. At 110 km they sit head to head across Grand Est
 *   with air between them.
 *
 * The arrow therefore STRADDLES its frontier rather than leaving it, which is
 * also the truer drawing: a cross-border flow crosses a border.
 */
const ARROW_ABROAD_M = 190_000;
const ARROW_INLAND_M = 110_000;
const ARROW_LENGTH_M = ARROW_ABROAD_M + ARROW_INLAND_M;
/**
 * The glyph's depth — its short side — at a flow of nothing and at saturation.
 *
 * The floor is not zero and is not proportional: a 12 MW border is a real
 * border, and the mark has to be an arrow before it is a measurement. 150 km of
 * box is a 17.6 km shaft, 15 px at the reference altitude — inside the band the
 * swept tube occupied, which is where the first reader stopped calling the flow
 * illegible.
 */
const ARROW_DEPTH_MIN_M = 150_000;
const ARROW_DEPTH_MAX_M = ARROW_LENGTH_M;
/**
 * How far above the ellipsoid the arrow rides — and it is a Z-ORDER, not a
 * height.
 *
 * It was 30 km, and at 30 km the mark was INVISIBLE over France. A prism is
 * translucent geometry: it writes no depth, so Cesium sorts it against the
 * billboard by distance and paints the nearer one last. From anywhere near
 * nadir the prism's TOP FACE — up to 120 km of altitude at
 * {@link PRISM_TOP_ALPHA}, which is 0.95 — is nearer the camera than an arrow
 * at 30 km, and 0.95 of an opaque face leaves 5 % of the arrow. An import's
 * head sits 110 km inside France, under exactly that face. The reader's
 * verdict, looking at the first build of this mark: « les flèches sont
 * toujours très peu visibles ».
 *
 * So the arrow rides above the TALLEST PRISM THIS LAYER CAN DRAW, which is
 * `PRISM_MAX_HEIGHT_M` and not the tallest one in tonight's data — a height
 * that moved with the feed would put the fix at the mercy of a quiet evening.
 * Nothing about the number is a measurement: the glyph is flat, horizontal,
 * has no base and no guide, and it is the same 130 km whatever the flow.
 *
 * What it costs is parallax, and it is small where this layer is read: a mark
 * 130 km up is displaced by `130 × tan(θ)` km from the ground under it, which
 * is 28 km at the 12° off-nadir of a national view and 49 km at the 21° of the
 * reference altitude — against a glyph 300 km long.
 */
const ARROW_ALTITUDE_M = PRISM_MAX_HEIGHT_M + 10_000;
/**
 * Raster side for the arrow texture, in device pixels.
 *
 * Cesium's billboard atlas has no mipmaps, so this is a band and not a
 * maximum: too small and the arrow is magnified into a blur, too large and it
 * is minified into shimmer. The glyph draws at ~145 px across at the reference
 * altitude, so 192 covers it at 0.76× and leaves headroom for the closer looks
 * without paying for a 512 px atlas entry. ONE entry serves all five flows —
 * the artwork is white and the colour is a per-billboard multiply.
 */
const ARROW_RASTER_PX = 320;
/**
 * The edge's and the halo's widths, in the box `mapIcons` pads Maki's artwork
 * into — see {@link ARROW_VIEW_BOX}, which is wider than that pad because a
 * halo this wide would otherwise be clipped by the canvas.
 *
 * The prism carries its silhouette on a polygon outline, which Cesium strokes
 * for free. A billboard has no outline, so the edge is drawn INTO the texture:
 * one stroke pass over the same path, at {@link PRISM_TOP_ALPHA}, over a fill
 * at {@link PRISM_BODY_ALPHA}.
 *
 * THE HALO IS THE PART THE PRISM DOES NOT NEED. A prism separates itself from
 * what is behind it by being a volume with a lit silhouette against ground.
 * This mark is a flat overlay, and what is behind it is OTHER MARKS OF THE
 * SAME HUE — a teal arrow crosses teal prisms, teal market outlines and a teal
 * coastline. Measured on the reader's own screenshot, a body at 0.62 with a
 * 0.55-unit edge and no halo is indistinguishable from the outline of the
 * country under it. So the two prism passes keep their alphas exactly, and a
 * wide dark stroke goes UNDER them to give them an edge to be translucent
 * against. It is the same discipline the three icon packs already record, for
 * the same reason.
 */
const ARROW_EDGE_UNITS = 1.0;
const ARROW_HALO_UNITS = 2.4;
/**
 * Halo ink. Black, and NOT opaque: at 0.72 it darkens what is behind the mark
 * instead of punching a hole in the map, which is what the label plates do
 * three lines away. It also survives the tint — Cesium multiplies
 * `billboard.color` into the texture and `0 × c = 0`.
 */
const ARROW_HALO_COLOR = 'rgba(0,0,0,0.72)';
/**
 * The arrow's canvas, padded past `MAP_ICON_VIEW_BOX`.
 *
 * Maki authors to `0 0 15 15` and draws to the edges; `mapIcons` pads one unit
 * for its own 1.72-unit halo. This halo is 2.4 units, so it strokes 1.2 units
 * outward and needs 1.6 of clearance. Padding the canvas moves no path
 * coordinate — the artwork is still Maki's, unrescaled.
 */
const ARROW_VIEW_BOX = '-1.6 -1.6 18.2 18.2';
/**
 * A quarter turn that makes Maki's arrow point UP in the texture.
 *
 * Not a preference — a CONTRACT. `iconOrientation.screenProjectedRotation()` is
 * this project's answer to "point a camera-facing quad along a real-world
 * course", written for the flight and AIS layers and proven in the field, and
 * its contract is `rotation = 0` ⇒ the icon points SCREEN-UP. `aisLiveVessels`
 * records the same thing in one line: « The shape points north (up) so
 * billboard rotation maps directly to heading. » Maki's arrow points RIGHT, so
 * it is turned once here and the shared helper is then used verbatim, with no
 * quarter-turn fudge at the call site to get wrong.
 *
 * An SVG `transform` moves no path coordinate — the artwork reaches the
 * rasteriser exactly as Mapbox published it, which is what `licenses/maki/
 * NOTICE` claims. The rotation is about the centre of Maki's own 15-unit box,
 * so a square canvas stays square.
 *
 * IT ALSO SWAPS THE BILLBOARD'S AXES. The glyph's long side is now the
 * texture's HEIGHT: `width` carries the depth and `height` the length. See
 * `repaintArcs`.
 */
const ARROW_UPRIGHT_TRANSFORM = 'rotate(-90 7.5 7.5)';

/**
 * The true perimeter of a région, drawn on the ground under its prism.
 *
 * Thin and half-transparent on purpose. It is not a second reading and must
 * not compete with the volume standing on it: its whole job is to be there
 * when a reader asks where the région actually ends, which the reduced
 * footprint no longer answers.
 */
const PERIMETER_WIDTH_PX = 2;
const PERIMETER_ALPHA = 0.55;

/**
 * A neighbouring market's outline. Wider and brighter than a région
 * perimeter — it is the only mark that market gets, where a région has a whole
 * volume, and at continental altitude a 2 px line at 55 % vanishes into the
 * imagery.
 */
const MARKET_OUTLINE_WIDTH_PX = 3;
const MARKET_OUTLINE_ALPHA = 0.85;

/**
 * Invert `REGION_DEPARTEMENTS` into a département → région lookup.
 * @returns {Map<string, string>}
 */
export function departementRegionIndex() {
  const index = new Map();
  for (const [region, departements] of Object.entries(REGION_DEPARTEMENTS)) {
    for (const code of departements) index.set(code, region);
  }
  return index;
}

/**
 * How far a prism's footprint is pulled in from the région it stands on.
 *
 * 0.90, and the number is a compromise stated in the header: below ~0.85 the
 * shape of a small région starts reading as a blob, above ~0.94 the canyon
 * between two neighbours closes at national altitude. At 0.90 the gap between
 * two average régions is ~25 km — 24 px in the 1600 × 1000 national view — and
 * the shrunk outline is still unmistakably the région.
 */
export const PRISM_FOOTPRINT_SCALE = 0.90;

/**
 * Rings under this many SQUARE DEGREES get an outline but no prism.
 *
 * 0.05 deg² is ~430 km² at these latitudes. What it excludes, measured on the
 * bundled file: Ré (85 km²), Oléron (174), Belle-Île (84), Noirmoutier (49),
 * Yeu (23) and the Îles d'Hyères. What it keeps: every mainland body, and
 * Corse at 0.95 deg² — nineteen times the threshold, so Corsica's blank state
 * stays a fact about éCO2mix and never becomes a fact about geometry.
 */
export const PRISM_MIN_RING_AREA_DEG2 = 0.05;

/**
 * Dissolve the bundled départements into one outline per région.
 *
 * This is the join that turns 96 polygons into 13 marks. Every ring returned
 * is CLOSED and ordered largest first, so `rings[0]` is the mainland body of
 * the région and everything after it is an island.
 *
 * Three products per région, and they are three different jobs:
 *
 *   `rings`       every dissolved ring, at true size. The PERIMETER, drawn as
 *                 a line on the ground: this is where the région actually
 *                 ends, and it is what makes the shrunk prism honest.
 *   `prismRings`  the rings above {@link PRISM_MIN_RING_AREA_DEG2}, each
 *                 scaled to {@link PRISM_FOOTPRINT_SCALE} about its OWN
 *                 centroid. The volume stands on these.
 *   `flatRings`   the rings above the same threshold at TRUE size, for the two
 *                 flat marks (measured zero, and Corse's stripe). A footprint
 *                 is a footprint: it is not pulled in, because nothing is
 *                 standing on it that needs a gap.
 *
 * Régions the grouping does not know are skipped, which is the same whitelist
 * rule `buildRegionRecords` applies to the payload — a département code with
 * no région is not drawable here whatever it is.
 *
 * @param {object|null|undefined} geojson The bundled département collection.
 * @returns {Map<string, {code:string, rings:Array, prismRings:Array, flatRings:Array}>}
 */
export function buildRegionShapes(geojson) {
  const index = departementRegionIndex();
  /** @type {Map<string, Array>} région code → every ring of every département. */
  const grouped = new Map();
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const code = String(feature?.properties?.code ?? '').trim();
    const region = index.get(code);
    if (!region) continue;
    const rings = geometryRings(feature.geometry);
    if (!rings.length) continue;
    const bucket = grouped.get(region);
    if (bucket) bucket.push(...rings);
    else grouped.set(region, [...rings]);
  }

  const shapes = new Map();
  for (const [region, rings] of grouped) {
    const dissolved = dissolveRings(rings);
    if (!dissolved.length) continue;
    const big = dissolved.filter((ring) => Math.abs(ringArea(ring)) >= PRISM_MIN_RING_AREA_DEG2);
    // A région whose every ring falls under the threshold would be an island
    // chain, which metropolitan France does not have — but a future file might,
    // and a région with no drawable body must not silently disappear.
    const flatRings = big.length ? big : [dissolved[0]];
    shapes.set(region, {
      code: region,
      rings: dissolved,
      flatRings,
      prismRings: flatRings.map((ring) => scaleRing(ring, PRISM_FOOTPRINT_SCALE)),
    });
  }
  return shapes;
}

/**
 * Where on the French frontier each market's arc touches down.
 *
 * The point of the French border NEAREST that market's reference point,
 * measured on the sphere. Derived from the geometry rather than typed in, so
 * it cannot drift away from the coastline the same file draws.
 *
 * **Corsica is excluded from the search, and that is the whole reason this
 * takes régions rather than a flat ring list.** Bonifacio is 314 km from the
 * Italian reference point and Menton is 411 km, so a naive nearest-vertex over
 * all of France would run the Italian arc out of Corsica — a région this layer
 * does not measure, on a border that is the Alps.
 *
 * @param {object|null|undefined} geojson The bundled département collection.
 * @returns {Map<string, number[]>} Market key → `[lon, lat]`.
 */
export function frontierAnchors(geojson) {
  const index = departementRegionIndex();
  const uncovered = new Set(UNCOVERED_REGIONS);
  const mainland = [];
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const code = String(feature?.properties?.code ?? '').trim();
    const region = index.get(code);
    if (!region || uncovered.has(region)) continue;
    mainland.push(...geometryRings(feature.geometry));
  }
  const anchors = new Map();
  if (!mainland.length) return anchors;
  for (const [key, point] of Object.entries(BORDER_ANCHORS)) {
    if (key === 'france') continue;
    const vertex = nearestRingVertex(mainland, point);
    if (vertex) anchors.set(key, vertex);
  }
  return anchors;
}

/**
 * Parse the bundled market-area outlines into one entry per `ech_comm_*` field.
 *
 * No dissolve here: Natural Earth's polygons are already whole countries, and
 * Germany and Belgium are two separate shapes that share one entry because
 * they share one upstream field, not because anyone merged them.
 *
 * @param {object|null|undefined} geojson `local_data/energy_market_areas`.
 * @returns {Array<{key:string, label:string, rings:Array}>}
 */
export function buildMarketOutlines(geojson) {
  const outlines = [];
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const key = String(feature?.properties?.key ?? '').trim();
    // The whitelist is the anchor table, i.e. the fields éCO2mix publishes: a
    // country the exchange list never mentions has no business being outlined.
    if (!key || !BORDER_ANCHORS[key] || key === 'france') continue;
    const rings = geometryRings(feature.geometry).filter((ring) => ring.length >= 4);
    if (!rings.length) continue;
    outlines.push({
      key,
      label: String(feature?.properties?.label ?? '').trim() || key,
      rings,
    });
  }
  return outlines;
}

/**
 * The colour each market's outline takes, from the flows actually drawn.
 *
 * The outline is the counterparty of an arc, so it carries the arc's class and
 * nothing else — teal where France is exporting to it, amber where France is
 * importing from it. A market whose flow is absent or under the deadband gets
 * the slate `balanced` colour: it is still a neighbour, and nothing is
 * crossing. That is the same rule as the arc itself, which disappears rather
 * than drawing a hairline — the arc says "no flow" by absence, the outline
 * says "no flow" by colour, and neither invents a direction.
 *
 * @param {Array<object>} arcs From {@link buildBorderArcs}.
 * @returns {Map<string, object>} Market key → a `BALANCE_STYLES` entry.
 */
export function marketOutlineStyles(arcs) {
  const styles = new Map();
  for (const [key] of Object.entries(BORDER_ANCHORS)) {
    if (key !== 'france') styles.set(key, BALANCE_STYLES.balanced);
  }
  for (const arc of Array.isArray(arcs) ? arcs : []) {
    if (styles.has(arc?.key)) styles.set(arc.key, arc.style);
  }
  return styles;
}

/**
 * The régions carrying NO published balance this refresh.
 *
 * Three causes, one answer. Corse is never in the payload; a région can carry
 * a null `ech_physiques`; and a région can be dropped from the payload
 * outright, which is what happened to Normandie on the 2026-09-10 15:04Z poll
 * — éCO2mix régional publishes per-région and a région that has not reported
 * inside the window simply is not there.
 *
 * The third case is the one that used to escape every counter in this module,
 * because every one of them counted rows in `records` and a dropped région has
 * no row. The legend therefore said « non publié 1 » under a map showing TWO
 * unpainted régions, and 11 + 1 did not make 13. Counting from the KNOWN set
 * instead of from the payload is what makes the three causes impossible to
 * tell apart in the arithmetic — which is correct, because the mark does not
 * tell them apart either.
 *
 * @param {Array<object>|null|undefined} records From {@link buildRegionRecords}.
 * @returns {Array<{code:string, name:string}>} Ordered by INSEE code.
 */
export function unmeasuredRegions(records) {
  const measured = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (Number.isFinite(record?.netPhysical)) measured.add(String(record.code));
  }
  return Object.keys(REGION_DEPARTEMENTS)
    .filter((code) => !measured.has(code))
    .sort()
    .map((code) => ({ code, name: REGION_NAMES[code] || code }));
}

/**
 * Format megawatts the way a French control-room readout would: thin-space
 * grouping, no decimals, sign carried by the verb rather than a minus.
 * @param {number|null|undefined} mw
 * @returns {string}
 */
export function formatMegawatts(mw) {
  if (!Number.isFinite(mw)) return '— MW';
  // `toLocaleString('fr-FR')` groups with U+202F on modern ICU and U+00A0 on
  // older ones. Both are normalised to a plain space so the label measures
  // and wraps predictably in the overlay's text layout.
  return `${Math.round(Math.abs(mw)).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} MW`;
}

/**
 * Classify one balance into its paint style.
 *
 * `netPhysical` is published as consumption minus generation, so POSITIVE is a
 * net importer — the inverse of the intuition that a positive number means a
 * surplus. That inversion is handled here, once.
 *
 * NULL means UNMEASURED and nothing else. It used to be returned inside the
 * deadband too, which put "éCO2mix published no figure" and "éCO2mix published
 * zero" behind the same absence — A1, and much more dangerous under a height
 * channel than under a flat fill. A measured near-zero now returns the
 * `balanced` style.
 *
 * The `ratio` is kept even though nothing paints with it any more: it is the
 * variable the fill alpha used to carry, and it now travels to the analyst
 * record instead of to a visual channel (A3).
 *
 * @param {number|null|undefined} netPhysical Megawatts, upstream sign.
 * @param {number|null|undefined} load Regional consumption, for the ratio.
 * @returns {{style:object, ratio:number}|null} Null only when unmeasured.
 */
export function balanceStyle(netPhysical, load) {
  if (!Number.isFinite(netPhysical)) return null;
  let style = BALANCE_STYLES.balanced;
  // SYMMETRIC and closed on both sides: ±deadband belongs to the direction,
  // and only strictly inside it is the exchange "balanced". This is the
  // convention the layer states everywhere else, and it is the one the prism
  // has to follow — not the reverse. See `energySignSentinel`.
  if (netPhysical >= BALANCE_DEADBAND_MW) style = BALANCE_STYLES.importer;
  else if (netPhysical <= -BALANCE_DEADBAND_MW) style = BALANCE_STYLES.exporter;
  // Ratio against the region's own load, so the picture is comparable across
  // regions AND across time — normalising against the current maximum would
  // restate the whole country every time one region moved.
  const ratio = Number.isFinite(load) && load > 0 ? Math.abs(netPhysical) / load : 0;
  return { style, ratio };
}

/**
 * One région as the prism grammar's `(value, ratio)` pair.
 *
 * HEIGHT takes |MW| — a magnitude, which is what `createPrismScale` demands,
 * since it refuses a negative `domainMin` precisely so that `heightM === 0`
 * can keep meaning "measured zero". COLOUR takes the SIGNED value, where the
 * frozen breaks are the deadband edges.
 *
 * The absolute value is computed only for a finite reading: `Math.abs(null)`
 * is 0, and handing that to the scale would manufacture a measured zero out of
 * a région the upstream did not publish — the one thing this grammar exists to
 * prevent.
 *
 * @param {object|null|undefined} record From {@link buildRegionRecords}.
 * @returns {object} A `prismRow` result against {@link ENERGY_PRISM_SCALE}.
 */
export function energyPrismRow(record) {
  const net = Number.isFinite(record?.netPhysical) ? record.netPhysical : null;
  return prismRow({
    code: record?.code ?? null,
    value: net === null ? null : Math.abs(net),
    // The colour channel of this layer is a SIGN CLASS, not a magnitude — the
    // legend says so, `ratioLabel` is "sens de l'échange". So the binner is
    // handed the class, decided by `balanceStyle`, rather than the raw MW.
    //
    // It has to be, because the two disagree on the boundary. `balanceStyle`
    // is symmetric and closed (±1 MW belongs to the direction); `prismRatioBin`
    // is half-open (`v <= breaks[i]`), so it put exactly +1 MW in "équilibrée"
    // while the label floating on top of the same prism said "IMPORTE 1 MW" —
    // two signs, one object, opposite claims. A symmetric closed band cannot
    // be expressed with two half-open breaks, so the layer decides and the
    // generic binner follows.
    ratio: net === null ? null : energySignSentinel(net),
  }, ENERGY_PRISM_SCALE);
}

/**
 * The value handed to `prismRatioBin` so its class matches `balanceStyle`.
 *
 * Not a measurement and never displayed: a sentinel that lands unambiguously
 * inside the intended class of the frozen breaks `[-deadband, +deadband]`.
 * @param {number} netPhysical Megawatts, upstream sign.
 * @returns {number}
 */
function energySignSentinel(netPhysical) {
  const key = balanceStyle(netPhysical, null)?.style?.key;
  if (key === 'importer') return BALANCE_DEADBAND_MW * 2;
  if (key === 'exporter') return -BALANCE_DEADBAND_MW;
  return 0;
}

/**
 * Join a `/api/energy-fr` payload to the known régions.
 *
 * The région code set is the whitelist: a `code_insee_region` the département
 * grouping does not know is not a metropolitan région and is discarded, which
 * is what keeps a future DOM row off a metropolitan map.
 *
 * @param {object|null|undefined} payload `/api/energy-fr` body.
 * @param {Map<string, object>} departements From `parseDepartements`.
 * @returns {Array<object>} One record per KNOWN, COVERED région present upstream.
 */
export function buildRegionRecords(payload, departements) {
  const regions = Array.isArray(payload?.regions) ? payload.regions : [];
  const uncovered = new Set(UNCOVERED_REGIONS);
  const records = [];
  for (const region of regions) {
    const code = String(region?.code ?? '').trim();
    const codes = REGION_DEPARTEMENTS[code];
    if (!codes || uncovered.has(code)) continue;
    const balance = balanceStyle(region.netPhysical, region.load);
    records.push({
      code,
      name: String(region?.name ?? '').trim() || code,
      at: String(region?.at ?? '').trim() || null,
      load: Number.isFinite(region?.load) ? region.load : null,
      generation: Number.isFinite(region?.generation) ? region.generation : null,
      lowCarbon: Number.isFinite(region?.lowCarbon) ? region.lowCarbon : null,
      netPhysical: Number.isFinite(region?.netPhysical) ? region.netPhysical : null,
      mix: Array.isArray(region?.mix) ? region.mix : [],
      departements: codes,
      anchor: regionAnchor(codes, departements),
      balance,
    });
  }
  // Weakest first, strongest last. Translucent volumes are depth-sorted by the
  // renderer, so this no longer decides who paints over whom — it is kept
  // because it makes the label cohort, the analyst snapshot and the legend
  // counts deterministic from one poll to the next.
  return records.sort((a, b) => Math.abs(a.netPhysical ?? 0) - Math.abs(b.netPhysical ?? 0)
    || a.code.localeCompare(b.code));
}

/**
 * Label anchor for a région: the unweighted mean of its départements' anchors.
 *
 * This is a LABEL ANCHOR, not a centre of mass — the départements of a région
 * are not equal in area, so the mean sits wherever the small ones pull it. It
 * only has to land inside the right région, which it does for all twelve.
 *
 * @param {ReadonlyArray<string>} codes
 * @param {Map<string, object>} departements
 * @returns {number[]|null}
 */
export function regionAnchor(codes, departements) {
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const code of codes || []) {
    const anchor = departements?.get?.(code)?.anchor;
    if (!Array.isArray(anchor) || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) continue;
    lon += anchor[0];
    lat += anchor[1];
    count += 1;
  }
  if (!count) return null;
  return [lon / count, lat / count];
}

/**
 * Turn the national exchange list into drawable flow arrows.
 *
 * Direction is the direction the electricity travels: a POSITIVE `mw` is an
 * import into France, so the arrow points AT the frontier and its tail is
 * abroad. A zero flow produces no arrow — an arrow of nothing is nothing.
 *
 * Every arrow spans the same {@link ARROW_LENGTH_M} from the frontier along the
 * great circle toward its market's reference point. The far end is a BEARING
 * and not a destination, which is why it can be one constant for all five
 * markets whose reference points are 94 km to 411 km away.
 *
 * The French end is the FRONTIER point for that market when one is known —
 * see the header on why five arrows leaving Berry was the wrong drawing. It
 * falls back to `BORDER_ANCHORS.france` only when the geometry has not loaded,
 * because an arrow drawn from slightly the wrong place still says which way the
 * power is going, and a missing arrow says nothing at all.
 *
 * @param {Array<object>|null|undefined} exchanges From `/api/energy-fr`.
 * @param {Map<string, number[]>|null} [frontier] From {@link frontierAnchors}.
 * @returns {Array<object>}
 */
export function buildBorderArcs(exchanges, frontier = null) {
  const arcs = [];
  for (const exchange of Array.isArray(exchanges) ? exchanges : []) {
    const key = String(exchange?.key ?? '').trim();
    const anchor = BORDER_ANCHORS[key];
    const mw = Number(exchange?.mw);
    if (!anchor || key === 'france' || !Number.isFinite(mw)) continue;
    if (Math.abs(mw) < BALANCE_DEADBAND_MW) continue;
    const importing = mw > 0;
    const style = importing ? BALANCE_STYLES.importer : BALANCE_STYLES.exporter;
    const home = frontier?.get?.(key) || BORDER_ANCHORS.france;

    // One length for every border, STRADDLING the frontier: 190 km on the
    // bearing of the market, 110 km back into France. See the header for the
    // two measurements that fix those numbers.
    const abroad = greatCircleWaypoint(home, anchor, ARROW_ABROAD_M) || anchor;
    // Walk the WHOLE length back from the far end, through the frontier and
    // out the other side. Same great circle, rather than a reflection of two
    // longitudes — the difference is tens of kilometres at this latitude.
    const inland = greatCircleWaypoint(abroad, home, ARROW_LENGTH_M) || home;

    const magnitude = Math.min(Math.abs(mw), ARC_SATURATION_MW) / ARC_SATURATION_MW;
    const depthM = ARROW_DEPTH_MIN_M + (ARROW_DEPTH_MAX_M - ARROW_DEPTH_MIN_M) * magnitude;

    arcs.push({
      key,
      label: String(exchange?.label ?? '').trim() || key,
      mw,
      importing,
      style,
      // Recorded so a test — and an analyst — can tell an arrow that left the
      // frontier from one that fell back to the centre of the country.
      fromFrontier: Boolean(frontier?.get?.(key)),
      lengthM: ARROW_LENGTH_M,
      depthM,
      altitudeM: ARROW_ALTITUDE_M,
      // The two ends, in the order the artwork reads: tail → tip. An import
      // runs abroad → France, an export France → abroad, and the pair is what
      // {@link borderArrowRotation} projects to aim the billboard.
      tail: importing ? abroad : inland,
      tip: importing ? inland : abroad,
      // The MIDDLE of the glyph, which is 40 km ABROAD of the frontier — the
      // straddle is 190/110, not 150/150. A billboard is placed by its centre,
      // so this has to be the centre and not the frontier, or the whole arrow
      // slides 40 km inland.
      anchor: greatCircleWaypoint(abroad, home, ARROW_LENGTH_M / 2) || home,
      // The frontier itself, kept because it is the fact the glyph is built
      // from and the thing a harness has to be able to check.
      frontier: home,
      // The label rides on the far end instead, out over the market. At 300 km
      // a label on the centre sits ON the shaft, and abroad is the one place
      // this layer draws nothing else — no prism, no région label.
      labelAt: abroad,
    });
  }
  return arcs;
}

/** @type {Map<number, ?string>} Raster size → the arrow's data URI. */
const _arrowGlyphCache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * Maki's arrow, drawn in the PRISM's grammar rather than the icon packs'.
 *
 * Every other billboard in this project is white line-art over a wide black
 * halo, because those marks are pictograms sitting on a photograph and the halo
 * is what separates them from it. This one is not a pictogram. It is the third
 * mark of a layer whose other two — the prism and the région perimeter — say
 * everything they say with ONE treatment: a translucent body carrying the
 * colour at {@link PRISM_BODY_ALPHA}, a near-opaque edge carrying the
 * silhouette at {@link PRISM_TOP_ALPHA}. The flow now says it the same way, on
 * the reader's own instruction, and the two alphas are IMPORTED rather than
 * retyped so the three marks cannot drift apart.
 *
 * A prism gets its edge free — Cesium strokes a polygon outline. A billboard
 * has no outline, so the edge is a second pass over the same path, baked into
 * the texture.
 *
 * TINT-SAFE the same way the halo packs are, and for the same reason: the
 * artwork is WHITE and the two alphas live in the SVG, so `billboard.color`
 * multiplies all four channels — white × c = c, 0.62 × 1 = 0.62 — and one
 * atlas entry serves the teal export and the orange import. Baking the hue in
 * would cost two entries and would fight the tint.
 *
 * @param {number} px Raster side, in device pixels.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null if the artwork went.
 */
export function borderArrowGlyph(px = ARROW_RASTER_PX) {
  const cached = _arrowGlyphCache.get(px);
  if (cached !== undefined) return cached;
  const geometry = mapIconGeometry('maki', 'arrow');
  // Null rather than a fallback shape, which is `mapIcons`' own rule: a glyph
  // that vanished upstream is a bug, and drawing a substitute hides it behind
  // a picture of the wrong thing.
  const uri = geometry
    ? `data:image/svg+xml;base64,${_b64(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
      + ` viewBox="${ARROW_VIEW_BOX}">`
      + `<g transform="${ARROW_UPRIGHT_TRANSFORM}">`
      // Halo first, under everything: the same geometry, stroked wide and
      // dark, so the two translucent passes have something to sit against.
      + `<g fill="${ARROW_HALO_COLOR}" stroke="${ARROW_HALO_COLOR}"`
      + ` stroke-width="${ARROW_HALO_UNITS}" stroke-linejoin="round"`
      + ` stroke-linecap="round">${geometry}</g>`
      + `<g fill="#ffffff" fill-opacity="${PRISM_BODY_ALPHA}"`
      + ` stroke="#ffffff" stroke-opacity="${PRISM_TOP_ALPHA}"`
      + ` stroke-width="${ARROW_EDGE_UNITS}" stroke-linejoin="round"`
      + ` stroke-linecap="round">${geometry}</g>`
      + '</g></svg>',
    )}`
    : null;
  _arrowGlyphCache.set(px, uri);
  return uri;
}

/**
 * The COURSE of a flow, in degrees clockwise from north, at the point the
 * glyph is drawn.
 *
 * Measured from the glyph's own centre toward its tip rather than end to end:
 * `screenProjectedRotation` builds an east-north-up frame AT THE POSITION it is
 * given, so the bearing has to be the local one there. Over 300 km of great
 * circle the two differ by under a degree, and taking the local one costs
 * nothing and cannot drift.
 *
 * @param {object|null|undefined} arc One entry from {@link buildBorderArcs}.
 * @returns {?number} Degrees in `[0, 360)`, or null when there is no course.
 */
export function borderArrowCourseDeg(arc) {
  const from = Array.isArray(arc?.anchor) ? arc.anchor : null;
  const to = Array.isArray(arc?.tip) ? arc.tip : null;
  if (!from || !to) return null;
  const rad = Math.PI / 180;
  const phi1 = from[1] * rad;
  const phi2 = to[1] * rad;
  const dLambda = (to[0] - from[0]) * rad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  // Two ends on the same point define no course, and `atan2(0, 0)` would
  // quietly answer 0 — due north, which is a direction this flow never had.
  if (Math.abs(y) < 1e-12 && Math.abs(x) < 1e-12) return null;
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/**
 * The rotation one border arrow should be drawn at, this frame.
 *
 * ── Why this delegates instead of computing an angle ────────────────────────
 *
 * It used to compute one: project both ends to window coordinates, take
 * `atan2(-dy, dx)`. The algebra was right and the mark still came out pointing
 * the wrong way, because the convention it assumed — `rotation = 0` puts the
 * artwork's RIGHT on screen-right — is not this project's. `iconOrientation.js`
 * owns that question for every camera-facing quad here (commercial flights,
 * military flights, AIS vessels), its contract is `rotation = 0` ⇒ the icon
 * points SCREEN-UP, and it is the version that survived a playtest: it projects
 * the course onto the camera's own right/up basis instead of probing a forward
 * point, which is what keeps it continuous through a tracked orbit and valid
 * when an end is off-screen or behind the camera.
 *
 * So the artwork is turned to point up once, at
 * {@link ARROW_UPRIGHT_TRANSFORM}, and the shared helper is used verbatim.
 * A layer inventing its own screen-space convention next to a module written
 * for it is how a mark ends up pointing at the wrong country.
 *
 * The previous value is passed through twice over: `screenProjectedRotation`
 * returns it when the course is edge-on to the camera and there is no angle to
 * read, and {@link stabilizeScreenRotation} holds it through sub-degree
 * projection noise, so a still camera does not make the arrow shiver.
 *
 * @param {Cesium.Scene|null|undefined} scene
 * @param {object|null|undefined} arc One entry from {@link buildBorderArcs}.
 * @param {number} [previous=0] Rotation the arrow already had.
 * @returns {number} Radians.
 */
export function borderArrowRotation(scene, arc, previous = 0) {
  const courseDeg = borderArrowCourseDeg(arc);
  // A stub scene — the unit harness hands this layer one — has no camera to
  // project with, and a layer that threw inside a render callback would take
  // the frame down with it.
  if (!scene?.camera || courseDeg === null) return previous;
  const position = Cesium.Cartesian3.fromDegrees(
    arc.anchor[0], arc.anchor[1], Number.isFinite(arc.altitudeM) ? arc.altitudeM : 0,
  );
  const next = screenProjectedRotation(scene, position, courseDeg, previous);
  const held = stabilizeScreenRotation(previous, next);
  return Number.isFinite(held) ? held : previous;
}

/**
 * Label text for a région. The verb and the megawatts carry the meaning; the
 * prism's colour only reinforces it, and its height is exactly this number.
 *
 * A région with no published balance says so. It used to say « ÉQUILIBRÉE »,
 * which was an assertion about a measurement nobody made.
 * @param {object} record
 * @returns {string}
 */
export function regionLabelText(record) {
  if (!record?.balance) return `${record?.name ?? ''} · SOLDE NON PUBLIÉ`;
  return `${record.name} · ${record.balance.style.verb} ${formatMegawatts(record.netPhysical)}`;
}

/**
 * Label text for a border flow. The verb and "vers"/"depuis" state the
 * direction in words. That used to be because a cone loses its sense at a
 * shallow camera angle; the billboard that replaced it does not, and the words
 * stay anyway — "vers" alone left the reader to infer which side of the
 * frontier the megawatts came from, which is a different failure.
 * @param {object} arc
 * @returns {string}
 */
export function borderLabelText(arc) {
  const importing = Boolean(arc?.importing);
  const direction = importing ? 'depuis' : 'vers';
  // The deadband admits a 1 MW flow, so the participle has to agree.
  const mw = Number(arc?.mw);
  const plural = !Number.isFinite(mw) || Math.round(Math.abs(mw)) >= 2 ? 's' : '';
  const verb = `${importing ? 'importé' : 'exporté'}${plural}`;
  return `${formatMegawatts(arc?.mw)} ${verb} ${direction} ${arc?.label}`;
}

/**
 * Height, in metres, at which a région's label rides.
 *
 * The TOP of its prism, not the ground. B2 asks for a height read « contre un
 * guide vertical »; here the guide is the label itself, which states the exact
 * megawatts the length encodes, at the exact altitude the length reaches. A
 * label left on the ground would sit behind 78 km of translucent volume and
 * annotate nothing.
 * @param {object|null|undefined} record
 * @returns {number} Metres above the ellipsoid, 0 when there is no prism.
 */
export function regionLabelHeightM(record) {
  const heightM = energyPrismRow(record).heightM;
  return Number.isFinite(heightM) ? heightM : 0;
}

/**
 * Build the source-owned presentation for one région label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createRegionOverlayEntry(record, position) {
  return {
    id: `energy-fr:region:${record.code}`,
    position,
    variant: 'label',
    title: regionLabelText(record),
    accent: record.balance ? record.balance.style.color : PRISM_NO_RATIO_COLOR,
    priority: Math.round(Math.abs(record.netPhysical ?? 0)),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/**
 * Build the source-owned presentation for one border-flow label.
 *
 * Border flows outrank régions in the collision cohort: there are only five of
 * them, they carry the headline "France is exporting tonight", and they sit
 * out over water or abroad where nothing else competes.
 * @param {object} arc
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createBorderOverlayEntry(arc, position) {
  return {
    id: `energy-fr:border:${arc.key}`,
    position,
    variant: 'label',
    title: borderLabelText(arc),
    accent: arc.style.color,
    priority: 1_000_000 + Math.round(Math.abs(arc.mw)),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the strongest flows, with stable identity as tie-break. */
export function selectEnergyOverlayCohort(entries, limit = ENERGY_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    ENERGY_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Roll the national block up into the figures the HUD and the analyst read.
 *
 * `lowCarbonShare` is computed against GENERATION, not consumption: the
 * denominator has to be what France produced, or a heavy export hour reports a
 * share above 100%.
 *
 * @param {object|null|undefined} national
 * @returns {object}
 */
export function summarizeNational(national) {
  const generation = Number.isFinite(national?.generation) ? national.generation : null;
  const lowCarbon = Number.isFinite(national?.lowCarbon) ? national.lowCarbon : null;
  return {
    at: national?.at || null,
    load: Number.isFinite(national?.load) ? national.load : null,
    co2: Number.isFinite(national?.co2) ? national.co2 : null,
    generation,
    lowCarbonShare: generation && generation > 0 && lowCarbon !== null
      ? Math.round((lowCarbon / generation) * 1000) / 10
      : null,
    netPhysical: Number.isFinite(national?.netPhysical) ? national.netPhysical : null,
    netCommercial: Number.isFinite(national?.netCommercial) ? national.netCommercial : null,
    topFiliere: Array.isArray(national?.mix) && national.mix.length ? national.mix[0] : null,
  };
}

/** French grouping for a plain integer, via the platform's own fr-FR rules. */
function fr(value) {
  // Same normalisation as `formatMegawatts`: ICU groups with U+202F or U+00A0
  // depending on its version, and both are flattened so the legend measures and
  // wraps identically everywhere.
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * The legend: TWO ROWS, and nothing else.
 *
 * It used to publish nine: a height ruler with three ticks, a row explaining
 * the shrunken footprint, a row explaining what colour is allowed to mean, a
 * clipped-domain row, a measured-zero row, a « non publié » row naming the
 * régions, a row on the flow glyph and a row on the market outlines. Every one
 * of them was TRUE, several were hard-won, and together they were a page of
 * prose in the corner of a globe. The reader's instruction was explicit:
 * « simplifie énormément la légende, ne garder que les informations vraiment
 * simples à comprendre […] simplement savoir si c'est excédentaire ou
 * déficitaire, il n'y a rien d'autre. »
 *
 * So: excédentaire, déficitaire, their counts, one short line each. That is
 * what someone who is not an electricity analyst came to find out.
 *
 * WHAT THAT COSTS, because it is a real cost and not a tidy-up. Three claims
 * the map still makes now go unexplained on screen: the prism's HEIGHT is the
 * balance in megawatts on a frozen 12 000 MW domain, the striped flat shapes
 * are régions éCO2mix did not publish, and the arrows' thickness is the
 * exchanged power. They are all still true, still tested, and still written
 * down — in this file's header, which is where a reader who wants them will
 * now have to go. The rows that said so are deleted rather than hidden,
 * because a collapsed row is still a row.
 *
 * Entry shape stays the repo's: `{ label, color, count?, blurb? }`.
 *
 * @param {Array<object>} records From {@link buildRegionRecords}.
 * @returns {Array<{label:string,color:?string,blurb?:string,count?:number}>}
 */
export function energyPrismLegend(records) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return [];
  const scale = ENERGY_PRISM_SCALE;
  const tally = prismTally(list.map((record) => ({
    code: record?.code,
    value: Number.isFinite(record?.netPhysical) ? Math.abs(record.netPhysical) : null,
    ratio: Number.isFinite(record?.netPhysical) ? record.netPhysical : null,
  })), scale);

  const entries = [];
  // Index 0 and 2 of the ratio ladder, never 1: the middle class is « sous
  // 1 MW », which is a deadband and not a thing a reader came to learn.
  for (const index of [0, 2]) {
    const count = tally.ratioCounts[index] || 0;
    if (!count) continue;
    const spec = index === 0 ? BALANCE_STYLES.exporter : BALANCE_STYLES.importer;
    entries.push({
      label: scale.ratioClassLabels[index],
      color: scale.ratioColors[index],
      count,
      blurb: spec.blurb,
    });
  }
  return entries;
}

/**
 * Map one région to a JSON-safe analyst record (analyst query engine seam).
 * Pure — no Cesium types. Missing fields are null, never NaN.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: text(record?.code) || `REGION-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    loadMw: num(record?.load),
    generationMw: num(record?.generation),
    // Restated in the direction a human asks the question in: positive means
    // this région sent power to the rest of France.
    netExportMw: Number.isFinite(record?.netPhysical) ? -record.netPhysical : null,
    // |balance| / load — the variable the fill alpha used to carry. It left a
    // visual channel (A3) and landed here, where it is a number rather than a
    // shade nobody could decode through a translucent volume.
    exchangeRatio: num(record?.balance?.ratio),
    // Metres of extrusion, so an analyst can check what the map claims to show
    // against the figure it was built from.
    prismHeightM: num(energyPrismRow(record).heightM),
    balance: text(record?.balance?.style?.key),
    topFiliere: record?.mix?.length ? text(record.mix[0].label) : null,
    observedAt: text(record?.at),
    lat: record?.anchor ? record.anchor[1] : null,
    lon: record?.anchor ? record.anchor[0] : null,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  clearSource: clearOverlaySource,
  setVisible: setOverlaySourceVisible,
});

/**
 * Which Cesium classification surface a clamped région footprint should target.
 * Same rule the Vigicrues and Vigilance layers established: classify against
 * ONLY the active surface, and fall back to BOTH for an unknown stack rather
 * than risk drawing nothing.
 *
 * Still live, but its audience has shrunk to the two FLAT states — the striped
 * "not published" footprint and the opaque "measured zero" one. A prism is not
 * classified at all and must not be handed a `classificationType`: the value
 * would be read and ignored (`index.js:148334-148336`), which is worse than
 * not setting it, because the next reader would believe it did something.
 * @param {string|null|undefined} activeId Active map-stack id.
 * @returns {Cesium.ClassificationType}
 */
export function energyClassificationTypeForStack(activeId) {
  const id = String(activeId || '').toLowerCase();
  if (!id) return Cesium.ClassificationType.BOTH;
  if (id.includes('photo') || id.includes('google') || id.includes('3d')) {
    return Cesium.ClassificationType.CESIUM_3D_TILE;
  }
  return Cesium.ClassificationType.TERRAIN;
}

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createFranceEnergyLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  apiUrl = API_URL,
  departementsUrl = DEPARTEMENTS_URL,
  departementsGeoJson = null,
  marketAreasUrl = MARKET_AREAS_URL,
  marketAreasGeoJson = null,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  /** @type {Map<string, object>} INSEE code → bundled polygon metadata. */
  let _departements = new Map();
  /** @type {Map<string, object>} Région code → dissolved outlines. */
  let _shapes = new Map();
  /** @type {Map<string, number[]>} Market key → its point on the French frontier. */
  let _frontier = new Map();
  /**
   * Région code → the polygon entities that carry its mark. One per drawable
   * ring, which is one for eleven of the thirteen régions: the dissolve is
   * what makes that number small, and it is the whole point.
   * @type {Map<string, Cesium.Entity[]>}
   */
  let _markEntities = new Map();
  /** @type {Map<string, Cesium.Entity[]>} Région code → ground perimeter lines. */
  let _perimeterEntities = new Map();
  /** @type {Map<string, Cesium.Entity[]>} Market key → its ground outline rings. */
  let _marketEntities = new Map();
  /**
   * Border key → the one billboard that carries its flow.
   *
   * ONE entity where there used to be two. The tube and the cone were a pair
   * that had to be shown and hidden together or a reader got an arrowhead
   * floating over an empty border; a ready-made arrow has no such seam.
   * @type {Map<string, Cesium.Entity>}
   */
  let _arcEntities = new Map();
  /**
   * Border key → the flow record its billboard should aim down, RIGHT NOW.
   *
   * Separate from `_arcEntities` because the two have different lifetimes: an
   * entity is created once and reused, while the record behind it is replaced
   * on every refresh. The rotation callback reads this table rather than
   * closing over a record, so a flow that reverses turns its arrow round.
   * @type {Map<string, object>}
   */
  let _arcAim = new Map();
  let _shapesPromise = null;
  let _records = [];
  let _arcs = [];
  let _national = summarizeNational(null);
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _feedSource = null;
  let _classificationType = Cesium.ClassificationType.BOTH;
  let _mapStackListener = null;

  /**
   * Retarget everything CLAMPED when the map stack changes.
   *
   * That is now three cohorts, not one: the flat région marks, the région
   * perimeters, and the market outlines. All of them drape on whichever
   * surface is active and all of them have to be told when it swaps.
   *
   * A prism is skipped, deliberately and by test: an extruded polygon is built
   * as an ordinary primitive and reads `classificationType` into a field it
   * never uses. Writing it there would cost a geometry rebuild to change
   * nothing at all. The border arrows are skipped too, and for the opposite
   * reason — they are billboards riding 30 km above the ellipsoid and are not
   * clamped to anything.
   */
  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    for (const parts of _markEntities.values()) {
      for (const entity of parts) {
        if (!entity.polygon || isExtruded(entity)) continue;
        entity.polygon.classificationType = next;
      }
    }
    for (const group of [_perimeterEntities, _marketEntities]) {
      for (const parts of group.values()) {
        for (const entity of parts) {
          if (entity.polyline) entity.polyline.classificationType = next;
        }
      }
    }
    _viewer?.scene?.requestRender?.();
  }

  /** True while this entity is drawn as a prism rather than as a footprint. */
  function isExtruded(entity) {
    return entity?.polygon?.extrudedHeight !== undefined;
  }

  /** A closed ring as the Cartesian hierarchy a Cesium polygon wants. */
  function hierarchyOf(ring) {
    return new Cesium.PolygonHierarchy(
      Cesium.Cartesian3.fromDegreesArray(flattenRing(ring)),
    );
  }

  /**
   * Load the bundled geometry ONCE, hidden.
   *
   * Two files, fetched together: the départements this layer dissolves into
   * régions, and the outlines of the five markets it exchanges with. The
   * market file is NOT fatal — a missing one costs the outlines and leaves the
   * régions and the arcs intact, which is the right trade for a decoration
   * that carries no measurement.
   */
  async function ensureShapes() {
    if (_shapesPromise) return _shapesPromise;
    _shapesPromise = (async () => {
      const geojson = departementsGeoJson
        || await (await fetch(departementsUrl)).json();
      _departements = parseDepartements(geojson);
      _shapes = buildRegionShapes(geojson);
      _frontier = frontierAnchors(geojson);

      let markets = [];
      try {
        const marketJson = marketAreasGeoJson
          || await (await fetch(marketAreasUrl)).json();
        markets = buildMarketOutlines(marketJson);
      } catch (error) {
        console.warn('[Data:Energy FR] Market outlines unavailable:', error);
      }

      const source = new Cesium.CustomDataSource('éCO2mix — mix électrique français');
      source.show = _enabled;

      for (const [code, shape] of _shapes) {
        // The MARK: one polygon per drawable ring, standing on the reduced
        // footprint whether it is extruded or flat. One footprint convention
        // for all three of A1's marks, and the perimeter below is what states
        // the true one.
        _markEntities.set(code, shape.prismRings.map((ring, part) => source.entities.add({
          id: `energy-fr:region:${code}:${part}`,
          properties: { code, kind: 'region', part },
          show: false,
          polygon: {
            hierarchy: hierarchyOf(ring),
            perPositionHeight: false,
            outline: false,
            classificationType: _classificationType,
          },
        })));
        // The PERIMETER: every dissolved ring at TRUE size, islands included,
        // clamped to the ground. This is the honesty half of the reduced
        // footprint — where the région actually ends.
        _perimeterEntities.set(code, shape.rings.map((ring, part) => source.entities.add({
          id: `energy-fr:perimeter:${code}:${part}`,
          properties: { code, kind: 'perimeter', part },
          show: false,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flattenRing(ring)),
            width: PERIMETER_WIDTH_PX,
            clampToGround: true,
            classificationType: _classificationType,
          },
        })));
      }

      for (const market of markets) {
        _marketEntities.set(market.key, market.rings.map((ring, part) => source.entities.add({
          id: `energy-fr:market:${market.key}:${part}`,
          properties: { code: market.key, kind: 'market', part },
          show: false,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flattenRing(ring)),
            width: MARKET_OUTLINE_WIDTH_PX,
            clampToGround: true,
            classificationType: _classificationType,
          },
        })));
      }

      if (_viewer) await _viewer.dataSources.add(source);
      _dataSource = source;
      return source;
    })().catch((error) => {
      // A failed shape load must be retryable, not a permanently poisoned
      // promise that leaves the layer silently empty for the session.
      _shapesPromise = null;
      throw error;
    });
    return _shapesPromise;
  }

  /**
   * Raise the current régions on the pre-built entities.
   *
   * Three marks, and they are the three states of A1:
   *
   *   measured, non-zero → PRISM. Base on the ellipsoid, top at |MW|, body
   *     translucent, silhouette and top edge near-opaque. The top edge is the
   *     reading instrument, which is why it gets the outline Cesium only
   *     allows off terrain.
   *   measured at zero   → FLAT, filled, opaque, ground-clamped, slate.
   *   not measured       → FLAT, STRIPED, ground-clamped. Corse lives here,
   *     permanently, and so does any région the upstream drops mid-session.
   *
   * All three stand on the same reduced footprint and all three carry the same
   * true perimeter underneath, so swapping between them changes the mark and
   * never the geometry a reader is measuring against.
   *
   * Only reached when the poll signature moved, i.e. at most once per upstream
   * 15-minute step, so rebuilding the extruded geometry costs one frame per
   * step rather than one per poll.
   */
  function repaint() {
    const painted = new Set();
    for (const record of _records) {
      const row = energyPrismRow(record);
      const material = prismMaterial(row);
      const color = Cesium.Color
        .fromCssColorString(row.color || PRISM_NO_RATIO_COLOR);
      painted.add(record.code);
      for (const entity of _markEntities.get(record.code) || []) {
        applyPrism(entity, row, material, color.withAlpha(PRISM_TOP_ALPHA));
      }
      applyPerimeter(record.code, color.withAlpha(PERIMETER_ALPHA));
    }
    // Everything else — Corse, and any région the upstream dropped this
    // refresh — is drawn as a DECLARED absence rather than as a hole. Under the
    // flat regime these were hidden, which made "not published" and "nothing
    // here" the same pixel; a height channel cannot afford that (A1).
    const stripe = unpublishedMaterial();
    const slate = Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR);
    for (const [code, parts] of _markEntities) {
      if (painted.has(code)) continue;
      for (const entity of parts) applyUnpublished(entity, stripe);
      applyPerimeter(code, slate.withAlpha(PERIMETER_ALPHA));
    }
    repaintArcs();
    repaintMarkets();
    _viewer?.scene?.requestRender?.();
  }

  /** Body material for one prism row: the sign's colour, or the stripe. */
  function prismMaterial(row) {
    if (!row.hasValue || !row.color) return unpublishedMaterial();
    return new Cesium.ColorMaterialProperty(
      Cesium.Color.fromCssColorString(row.color)
        // A flat footprint is composited over imagery and needs to stay
        // legible; a prism body is composited over the sky and over other
        // prisms, and its top edge is what carries the reading.
        .withAlpha(row.extruded ? PRISM_BODY_ALPHA : PRISM_TOP_ALPHA),
    );
  }

  /**
   * The stripe that says "nobody published this".
   *
   * A MOTIF, not a tint (D3): a photorealistic globe has no neutral colour, and
   * a pattern is the encoding that survives the NVG and FLIR passes. Cesium's
   * stripe runs along the polygon's texture axes, so these are bands rather
   * than diagonals — the legend swatch hatches, the map bands, and both read as
   * "pattern, therefore not a measurement".
   *
   * Known degradation, stated rather than hidden: a non-colour material on a
   * clamped polygon needs `GroundPrimitive.supportsMaterials`, which wants the
   * depth-texture extension. Where that is missing, Cesium builds the footprint
   * as an ordinary primitive at height 0 and Corsican terrain hides it — i.e.
   * the layer falls back to exactly the behaviour it had before this change,
   * on the machines that could not have done better anyway. The perimeter line
   * is drawn either way, so Corsica never disappears entirely.
   */
  function unpublishedMaterial() {
    const slate = Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR);
    return new Cesium.StripeMaterialProperty({
      orientation: Cesium.StripeOrientation.VERTICAL,
      evenColor: slate.withAlpha(0.55),
      oddColor: slate.withAlpha(0.05),
      repeat: 18,
    });
  }

  /** Apply one prism row to one Cesium polygon entity. */
  function applyPrism(entity, row, material, outlineColor) {
    const polygon = entity.polygon;
    if (!polygon) return;
    polygon.material = material;
    if (row.extruded) {
      polygon.height = PRISM_BASE_HEIGHT_M;
      polygon.extrudedHeight = row.heightM;
      // Both must stay put: a base clamped to terrain would start the Savoie
      // prism 2 km above the Landes one, so its TOP would sit 2 km higher at
      // equal megawatts — a bias correlated with relief, on the one channel
      // that now carries the measurement.
      polygon.perPositionHeight = false;
      polygon.classificationType = undefined;
      polygon.outline = true;
      polygon.outlineColor = outlineColor;
      polygon.outlineWidth = 1;
    } else {
      // A measured zero has no prism, so it goes back on the ground where the
      // terrain cannot swallow it, and it takes the classification with it.
      polygon.height = undefined;
      polygon.extrudedHeight = undefined;
      polygon.classificationType = _classificationType;
      polygon.outline = false;
    }
    entity.show = true;
  }

  /** Draw one ring of an unmeasured région as a striped footprint. */
  function applyUnpublished(entity, material) {
    const polygon = entity.polygon;
    if (!polygon) return;
    polygon.height = undefined;
    polygon.extrudedHeight = undefined;
    polygon.classificationType = _classificationType;
    polygon.outline = false;
    polygon.material = material;
    entity.show = true;
  }

  /**
   * Show a région's true perimeter under whichever mark it is carrying.
   *
   * Same colour as the mark, at a lower alpha: it is the base of the volume
   * standing on it, not a second reading. It is the only place the exact
   * extent of a région is stated, so it is drawn for EVERY région including
   * the unmeasured ones — Corse has a perimeter even though it has no figure.
   */
  function applyPerimeter(code, color) {
    for (const entity of _perimeterEntities.get(code) || []) {
      if (!entity.polyline) continue;
      entity.polyline.material = new Cesium.ColorMaterialProperty(color);
      entity.show = true;
    }
  }

  /**
   * Rebuild the border flows: one ready-made arrow each, aimed down the flow.
   *
   * The image is built once, for every border and every colour: the artwork is
   * white and Cesium multiplies `billboard.color` into all four channels, so
   * the teal export and the orange import share a single atlas entry and both
   * carry the prism's translucent body and near-opaque edge. A hue baked into
   * the texture would need two entries and would fight the tint.
   *
   * ROTATION IS A CALLBACK, and it is the only property here that is. The
   * angle an arrow must be drawn at depends on where the camera is, so it is
   * re-derived on every frame the scene paints — inside the same update that
   * paints it, which is what keeps the arrow from lagging a moving camera by a
   * frame. `borderArrowRotation` says which module owns that angle and why it
   * is not this one.
   *
   * The aim reads from `_arcAim` rather than from the `arc` in hand: the
   * entity outlives the refresh that made it, and a callback closed over a
   * stale record would keep aiming at last hour's flow after it reversed.
   */
  function repaintArcs() {
    if (!_dataSource) return;
    const image = borderArrowGlyph(ARROW_RASTER_PX);
    const live = new Set();
    for (const arc of _arcs) {
      live.add(arc.key);
      _arcAim.set(arc.key, arc);
      const color = Cesium.Color.fromCssColorString(arc.style.color);
      const position = Cesium.Cartesian3.fromDegrees(
        arc.anchor[0], arc.anchor[1], arc.altitudeM,
      );

      let entity = _arcEntities.get(arc.key);
      if (!entity) {
        const key = arc.key;
        let lastRotation = 0;
        entity = _dataSource.entities.add({
          id: `energy-fr:arc:${key}`,
          // The two ends and the frontier they straddle travel on the entity,
          // not just in the model. A billboard is ONE position, so without
          // them nothing reading the live scene — the browser harness, a pick,
          // an inspector — could tell an arrow that crosses its own border
          // from one that does not.
          properties: {
            code: key,
            kind: 'arc',
            tail: arc.tail,
            tip: arc.tip,
            frontier: arc.frontier,
          },
          position,
          billboard: {
            image,
            // Metres, like every other mark in this layer. A screen size would
            // leave the flow a fixed hairline while the prisms beside it grow.
            sizeInMeters: true,
            // SWAPPED, and it is the upright transform that swaps them: the
            // artwork's long side runs up the texture now, so `height` is the
            // glyph's length and `width` its depth.
            width: arc.depthM,
            height: arc.lengthM,
            color,
            rotation: new Cesium.CallbackProperty(() => {
              lastRotation = borderArrowRotation(
                _viewer?.scene, _arcAim.get(key), lastRotation,
              );
              return lastRotation;
            }, false),
            // The arrow rides 30 km up and is read from above: it must be
            // occluded by the globe behind it, which is the default, and must
            // NOT be punched through terrain in front of it.
            heightReference: Cesium.HeightReference.NONE,
          },
        });
        _arcEntities.set(key, entity);
      } else {
        entity.position = position;
        entity.properties.tail = arc.tail;
        entity.properties.tip = arc.tip;
        entity.properties.frontier = arc.frontier;
        entity.billboard.width = arc.depthM;
        entity.billboard.height = arc.lengthM;
        entity.billboard.color = color;
      }
      entity.show = true;
    }
    for (const [key, entity] of _arcEntities) {
      if (live.has(key)) continue;
      entity.show = false;
      // Dropped from the aim table too: a hidden arrow must not keep a
      // callback alive on a flow the feed no longer publishes.
      _arcAim.delete(key);
    }
  }

  /**
   * Colour the market outlines from the flows, and show them all.
   *
   * Unlike an arc, an outline does NOT disappear when the flow falls under the
   * deadband: an arc is a direction and a direction of nothing is nothing,
   * while the outline answers "who is on the other side", which is true at
   * zero. It goes slate and stays drawn.
   */
  function repaintMarkets() {
    const styles = marketOutlineStyles(_arcs);
    for (const [key, parts] of _marketEntities) {
      const style = styles.get(key) || BALANCE_STYLES.balanced;
      const color = Cesium.Color.fromCssColorString(style.color).withAlpha(MARKET_OUTLINE_ALPHA);
      for (const entity of parts) {
        if (!entity.polyline) continue;
        entity.polyline.material = new Cesium.ColorMaterialProperty(color);
        entity.show = true;
      }
    }
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _records) {
      // No anchor means no shape to hang the label off. A missing BALANCE is
      // no longer a reason to skip: the label is the only place a reader can
      // learn that éCO2mix published nothing for this région, and it says so
      // in words rather than by not being there.
      if (!record.anchor) continue;
      entries.push(createRegionOverlayEntry(
        record,
        // At the TOP of the prism: the label is the numeric readout of the
        // length, so it belongs at the end of the length.
        Cesium.Cartesian3.fromDegrees(
          record.anchor[0],
          record.anchor[1],
          regionLabelHeightM(record),
        ),
      ));
    }
    // The régions with NO figure get a label too, and it is the whole answer to
    // « on n'a pas l'information, c'est ça ? ». They are not in `_records`, so
    // nothing above reaches them: without this they are a grey shape with no
    // name, and the reader has to work out which région is missing by looking
    // at the coastline.
    for (const region of unmeasuredRegions(_records)) {
      const anchor = regionAnchor(REGION_DEPARTEMENTS[region.code], _departements);
      if (!anchor) continue;
      entries.push(createRegionOverlayEntry(
        { code: region.code, name: region.name, netPhysical: null, balance: null },
        Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1], 0),
      ));
    }
    for (const arc of _arcs) {
      if (!Number.isFinite(arc.labelAt?.[0])) continue;
      // The far end of the glyph, at the height the arrow is drawn at, so the
      // label sits beside its mark rather than across it or 30 km under it.
      entries.push(createBorderOverlayEntry(
        arc,
        Cesium.Cartesian3.fromDegrees(arc.labelAt[0], arc.labelAt[1], arc.altitudeM),
      ));
    }
    overlayHost.setEntries(
      ENERGY_OVERLAY_SOURCE_ID,
      selectEnergyOverlayCohort(entries),
      {
        cohortLimit: ENERGY_OVERLAY_COHORT_LIMIT,
        collisionCapacity: ENERGY_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /** Fingerprint of the painted state, so an unchanged snapshot repaints nothing. */
  function signatureOf(records, arcs) {
    return [
      records.map((r) => `${r.code}:${Math.round(r.netPhysical ?? 0)}`).join(','),
      arcs.map((a) => `${a.key}:${Math.round(a.mw)}`).join(','),
    ].join('|');
  }

  const layer = {
    id: 'france-energy',
    name: 'Mix élec (FR)',
    icon: '⚡',
    source: 'RTE / ODRÉ',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _records = [];
      _arcs = [];
      _frontier = new Map();
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _feedSource = null;
      _classificationType = energyClassificationTypeForStack(null);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(energyClassificationTypeForStack(event?.detail?.activeId));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Energy FR] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, true);
      publishOverlay();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        await ensureShapes();
      } catch (error) {
        console.warn('[Data:Energy FR] Département polygons unavailable:', error);
        _lastError = 'Département polygons unavailable';
        return false;
      }
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          _lastError = `éCO2mix HTTP ${response.status}`;
          console.warn(`[Data:Energy FR] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        if (!payload?.national && !Array.isArray(payload?.regions)) {
          _lastError = 'Malformed éCO2mix response';
          return false;
        }

        const records = buildRegionRecords(payload, _departements);
        const arcs = buildBorderArcs(payload?.national?.exchanges, _frontier);
        const signature = signatureOf(records, arcs);
        _records = records;
        _arcs = arcs;
        _national = summarizeNational(payload.national);
        _feedSource = String(payload.source ?? '').trim() || null;
        _stale = payload.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;

        if (signature !== _signature) {
          _signature = signature;
          repaint();
          publishOverlay();
        }

        const share = _national.lowCarbonShare;
        console.log(
          `[Data:Energy FR] Updated: ${_records.length} régions,`
          + ` ${formatMegawatts(_national.load)} appelés,`
          + ` ${share === null ? '—' : `${share}%`} bas-carbone,`
          + ` ${_national.co2 ?? '—'} gCO₂/kWh`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Energy FR] Fetch error:', error);
        _lastError = 'éCO2mix network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource) {
        viewer?.dataSources?.remove?.(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _departements = new Map();
      _shapes = new Map();
      _frontier = new Map();
      _markEntities = new Map();
      _perimeterEntities = new Map();
      _marketEntities = new Map();
      _arcEntities = new Map();
      _arcAim = new Map();
      _shapesPromise = null;
      _records = [];
      _arcs = [];
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _feedSource = null;
    },

    /**
     * Snapshot the régions as plain JSON-safe objects for the analyst query
     * engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=200]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const result = [];
      for (const record of _records) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    /**
     * The prism legend, for the toggle row AND the on-map block. No chips: the
     * layer has no options.
     *
     * D1 is not optional here — the height means nothing without its ruler, and
     * a ruler that lives behind a panel is not a legend. `surfaceFill` is
     * false: the only ground-classified surfaces left are the two flat marks,
     * whose colour carries no value for a façade's shading to corrupt.
     * @returns {{chips: Array<object>, legend: Array<object>, surfaceFill: boolean}}
     */
    getRowControls() {
      return {
        chips: [],
        legend: energyPrismLegend(_records),
        surfaceFill: false,
      };
    },

    getStats() {
      const rows = _records.map(energyPrismRow);
      return {
        // Régions actually drawn as prisms. Corse is excluded upstream, so 12
        // is a full house and reporting 13 would imply a coverage that is not
        // there — it gets its striped footprint, and `unpublishedRegions`
        // below counts it.
        count: _records.length,
        // A5, and the HUD is now the ONLY place it is said: how many prisms
        // are stuck at the top of the frozen domain and have stopped saying
        // how much.
        clippedRegions: rows.filter((row) => row.clipped).length,
        // Régions carrying no figure, Corse INCLUDED — counted from the known
        // set, so a région the feed dropped entirely is in it. The old count
        // filtered `_records`, which is the one place a dropped région is not.
        unpublishedRegions: unmeasuredRegions(_records).length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        loadMw: _national.load,
        co2gPerKwh: _national.co2,
        lowCarbonShare: _national.lowCarbonShare,
        // Restated as "France sent this much abroad" — the upstream sign is
        // consumption-minus-generation, which reads backwards in a HUD.
        netExportMw: Number.isFinite(_national.netPhysical) ? -_national.netPhysical : null,
        // Kept separate and separately named: the five commercial balances do
        // not sum to the physical one. See the module header.
        netCommercialExportMw: Number.isFinite(_national.netCommercial)
          ? -_national.netCommercial
          : null,
        topFiliere: _national.topFiliere ? _national.topFiliere.label : null,
        borders: _arcs.length,
        // Licence Ouverte 2.0 obliges the producer AND the last-update date.
        updateTime: _national.at,
        feedSource: _feedSource,
      };
    },
  };

  return layer;
}

const franceEnergyLayer = createFranceEnergyLayer();

export default franceEnergyLayer;
