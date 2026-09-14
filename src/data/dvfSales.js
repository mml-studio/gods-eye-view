import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { ADDRESS_SCAN_MIN_SHIFT_KM, createAddressScanLayer } from './addressScanLayer.js';
import { clearBuildingTheme, registerBuildingTheme } from './buildingTheme.js';
import { dvfCellBreaks, saleKind } from './dvfFeed.js';
import { publishJoin } from './layerJoins.js';
import { drawScanBoundary } from './scanBoundary.js';
import { cellDiscRadiusM, discRing } from './scanCells.js';
import { SCAN_CELL_MIN_ALTITUDE_M, scanCellParams } from './scanRegime.js';
import { gpuClassificationTypeForScene } from './urbanismeGpu.js';

/**
 * DVF — what the flats around this point actually sold for, on the buildings
 * they sold in.
 *
 * The register is the file a French buyer opens by hand, one commune at a time.
 * Drawn in place it answers the question that survey does not: not "what is the
 * average in the 13th" but "what did the three buildings I can see change hands
 * for, and when".
 *
 * ── WHY SO MANY DOTS ARE NEUTRAL ───────────────────────────────────────────
 *
 * A price per square metre is a comparable only when the sale bought exactly
 * one dwelling. `dvfFeed.js` carries the measurement: one captured mutation is
 * a €32,000,000 building spread over 179 rows, and the obvious arithmetic turns
 * it into €1.28 million per square metre. Those sales are still drawn — they
 * happened — but in the neutral slate, with no ratio. A colour would be a claim
 * the register does not support.
 *
 * That neutral moved from `#7c8aa0` to `#9aa7bd` on 2026-09-03, and the reason
 * is measured, not aesthetic. Since these sales now also paint BUILDING VOLUMES
 * (below), the neutral has to stay distinguishable from `buildingTheme.js`'s
 * "nobody measured this one" wash. Against the six BD TOPO usage colours washed
 * and then darkened across the layer's whole height range, `#7c8aa0` sat at
 * ΔE76 **25.0** — exactly on `BUILDING_THEME_MIN_DELTA_E`, one rounding away
 * from reading as "no data". `#9aa7bd` measures **35.6** against the same set,
 * while staying at least **45.7** from every price class of the ramp. Two
 * different admissions, two colours nobody has to squint at.
 *
 * ── THE DENOMINATOR, AND WHY IT IS NOT THE VIEWPORT ANY MORE (C1) ──────────
 *
 * Until 2026-09-03 each sale was coloured against the median of the sales
 * inside the scan radius — the median of whatever the camera was pointing at.
 * `docs/CARTOGRAPHIE.md` C1 forbids exactly that, and the fixture shows why it
 * is not a theoretical objection: inside ONE arrondissement the local median is
 * 8 857 €/m² from avenue de France and 12 406 €/m² from rue de Tolbiac 1.5 km
 * away, a 40 % swing with no row of data changed. Worse, both the cheapest
 * (6 797 €/m²) and the dearest (12 406 €/m²) sale of the captured sample came
 * out at *exactly* 1.00 × the local median when the camera sat on them — the
 * two extremes of the arrondissement, both painted "average yellow", because
 * the median of one sale is that sale.
 *
 * The ratio itself was never the problem: an absolute €/m² ramp paints all of
 * Paris one colour and stops answering "is this dear FOR HERE". So the fraction
 * stays and the denominator becomes stable and NAMED — the median of the
 * COMMUNE (the arrondissement, where one exists, because that is how DVF itself
 * publishes) over the editions in hand, computed by `dvfFeed.communeReference`
 * from the very rows the proxy already parsed. Against it the same six sales
 * spread across four classes: 6 797 → 0,76 (green), 7 182 → 0,80 (green),
 * 8 857 → 0,99 and 9 054 → 1,01 (yellow), 10 464 → 1,17 (amber), 12 406 → 1,39
 * (red). The extremes stop being average.
 *
 * The denominator is printed in the legend and on every card, because a ratio
 * whose denominator is not written down is not a measurement. It changes when
 * the reader crosses into another commune — which is a change of REFERENCE
 * TERRITORY, announced in the legend, not a phantom of the framing: widening
 * the view, zooming, or sharing the link never moves it. That is the C1
 * conformity test in the doctrine, and `dvfSales.test.mjs` runs it.
 *
 * The class breaks themselves are frozen ratios ({@link DVF_RATIO_BREAKS},
 * ±5 % and ±25 %), never quantiles of the sample, and the legend restates them
 * in €/m² at the current reference so a reader gets the bounds in the unit of
 * the phenomenon as well as in ratio.
 *
 * WHEN THERE IS NO DENOMINATOR. `basis: 'none'` is answered, never a silent
 * substitution — and it is provably unreachable while there is anything to
 * colour: the served sales are a subset of the mutations the reference is
 * computed from, so "no comparable in the commune" implies "no comparable on
 * screen". A sale that somehow arrived with a ratio and no basis is painted
 * `#c46be0` (ΔE76 63.1 from the nearest price class, 66.3 from the wash) and
 * gets its own legend row, because A1 does not admit an unmarked fallback even
 * for a state the test says cannot happen.
 *
 * ── THE VOLUMES (piste 1 de docs/REPRESENTATION.md) ────────────────────────
 *
 * The layer registers a building theme (`buildingTheme.js`, precedence 20) so
 * that when Bâti 3D is on, the BD TOPO volumes carry this same ratio and the
 * street becomes the price map instead of a field of pins above the roofs.
 *
 * • **`reduce` takes the MOST RECENT mutation of the building, not a median of
 *   them.** Several sales on one volume is the normal case, and they are not
 *   contemporaries: the editions in hand span up to five years, so a median
 *   would publish a price that was never asked, at a date that does not exist.
 *   "Worst of the block" — the right answer for a DPE label — has no meaning
 *   here either: there is no bad price, only a high one. What a buyer is handed
 *   as a comparable is the last transaction, so that is what the volume shows.
 *   Ties are broken by the larger dwelling surface, then by mutation id, so the
 *   answer never depends on the order the proxy happened to concatenate its
 *   editions in.
 *
 * • **The most recent mutation wins even when it has no €/m².** Falling back to
 *   the most recent *comparable* one would paint a 2021 price onto a building
 *   that changed hands in 2024 for an undisclosed split — presenting a stale
 *   number as current, which is the worse lie. Instead the volume takes the
 *   neutral slate and its own legend row: "the last thing that happened here
 *   cannot be priced" is information, and it is *not* the same statement as
 *   "nothing happened here", which is the wash.
 *
 * • **The marker stays, at full size.** It is the click surface and the card,
 *   it is the only thing on screen when Bâti 3D is off, and it is drawn for
 *   sales the join cannot place on any volume. It is NOT shrunk when the theme
 *   paints, for two reasons: the layer would have to import the BD TOPO module
 *   to know whether volumes are actually loaded — the one-way coupling the
 *   theme registry exists to avoid — and marker size already carries "has a
 *   comparable €/m²" (19 px) versus "does not" (15 px). Making it also carry
 *   another layer's on/off state is A3, twice over.
 *
 * • **An unpainted volume is not a building nobody bought.** The scan asks the
 *   register about a 300 m disc; BD TOPO loads volumes over a box up to 9 km
 *   wide. Most unpainted volumes were therefore never asked about, so the
 *   theme's `unknownLabel` says "hors du rayon de 300 m ou sans mutation" and
 *   never "sans mutation". Publishing the layer's own reach as a fact about the
 *   market is A1 at the scale of a district.
 *
 * • **This layer does not count the volumes it paints.** The painted /
 *   unpainted tally belongs to whoever owns the geometry, and `bdtopo` prints
 *   it on its own row from the join it actually performed. Re-running the join
 *   here to publish a second number would be 2–9 ms of duplicated work for a
 *   figure that would be WRONG whenever Bâti 3D is off or the photoreal stack
 *   is up: this layer would claim 42 painted volumes with none on screen.
 *   What it publishes is what it knows — how many sales it handed over, how
 *   many of those can carry a colour, and what they are divided by.
 *
 * @module data/dvfSales
 */

/** Layer id — also the theme id in the building-theme registry. */
export const DVF_LAYER_ID = 'dvf-sales';

/**
 * WHICH SALES ARE DRAWN — the filter the reader kept thinking was already
 * there.
 *
 * Reported 2026-09-14, from rue des Basques in Bayonne: « j'ai l'impression
 * qu'on peut choisir soit de voir les appartements, soit de voir les maisons
 * […] beaucoup de ventes de maisons apparaissent, il n'y a que du collectif
 * ici ». Both halves of that were wrong and the interface was why. The chips
 * on the row said `Appart.` and `Maison`, and they belonged to the ESTIMATE
 * next door — they chose the subject a value was computed for and never
 * touched a single dot on the map. So the reader, with `Maison` lit, was
 * looking at 257 flats and reading them as houses. The register's own count
 * within 300 m of that point, over five editions: zero houses.
 *
 * Two ways to fix that. Label the chips harder, or make them true. This is
 * the second, and `docs/CARTOGRAPHIE.md` G1 is the reason it is not a
 * judgement call — « le filtre est le maillon manquant », named as the most
 * valuable missing component of the whole application. A reader who
 * spontaneously reaches for a control that is not there has said which
 * control to build.
 *
 * THREE VALUES AND NOT FOUR. `autre` — a commercial local, a cellar or a
 * parking space alone, bare land — is not offered as a class of its own
 * because nobody opens a price layer to look for a parking space; it is
 * included in `tous`, counted in the disclosure line when a filter hides it,
 * and named on its own card. `dvfFeed.saleKind` holds the fold and the
 * measurement behind it.
 *
 * IT IS A DRAW-ONLY PARAMETER. The register served every mutation in the
 * radius; filtering is a subset of rows already in memory, so the chip never
 * costs a request (`drawOnlyParams`, `addressScanLayer.js`). And the COLOURS
 * do not move when it changes: the denominator is the commune median over
 * every mutation of the editions, which is what C1 requires and what makes
 * "the flats here are dearer than this commune" a sentence that survives the
 * filter being on.
 *
 * THE VALUES ARE THE ESTIMATE'S OWN WORDS, and that is load-bearing rather
 * than tidy. `avis-valeur` sits on this same fused row and has always taken
 * `type: 'Appartement' | 'Maison'`; sharing the vocabulary is what lets one
 * chip steer both members through the manager's fan-out, so pressing
 * « Maisons » shows the houses AND estimates a house. One control, one reader
 * intention, two layers — instead of the two identical-looking strips of chips
 * that caused the confusion in the first place.
 */
export const DVF_TYPE_FILTERS = Object.freeze([
  Object.freeze({
    id: 'tous',
    label: 'Toutes',
    title: 'Toutes les mutations du rayon — logements, locaux, dépendances et terrains',
  }),
  Object.freeze({
    id: 'Appartement',
    label: 'Appart.',
    title: 'Seulement les mutations qui portent un appartement, cave ou parking compris',
  }),
  Object.freeze({
    id: 'Maison',
    label: 'Maisons',
    title: 'Seulement les mutations qui portent une maison — leur prix porte le terrain, '
      + 'qui n’est pas neutralisé',
  }),
]);

/**
 * The sales a filter keeps.
 * @param {Array<object>} sales
 * @param {string} filter One of {@link DVF_TYPE_FILTERS} ids.
 * @returns {Array<object>}
 */
export function filterSalesByType(sales, filter) {
  const list = Array.isArray(sales) ? sales : [];
  const wanted = filter === 'Appartement' ? 'appartement' : (filter === 'Maison' ? 'maison' : null);
  if (!wanted) return list;
  return list.filter((sale) => saleKind(sale) === wanted);
}

/** Refresh cadence. Editions are annual; this is about camera movement. */
const UPDATE_INTERVAL_MS = 600_000;
const SCAN_RADIUS_M = 300;

/**
 * The PLOT a sale bought, washed onto the ground under its marker.
 *
 * A euro sign floating over an oblique photoreal city names no building. The
 * register already says which ground changed hands — `id_parcelle` on every
 * mutation row, the same 14-character key Etalab's open cadastre is indexed
 * by, and the proxy joins the two (400 of 400 within 300 m of rue des
 * Basques in Bayonne; 170 distinct plots). So the layer draws the plot.
 *
 * CLAMPED, NOT EXTRUDED. `classificationType` paints the surface the globe is
 * actually drawing — terrain under a map basemap, the 3D tileset under the
 * photoreal stack — which is the one way a mark stays on the roofs instead of
 * 83 pixels beside them. It is also why the layer redraws on a map-stack
 * change: a classified primitive chooses its surface when it is BUILT.
 *
 * LIGHTER INK THAN THE CADASTRE'S OWN 0.28. The parcels are not the subject
 * here — the sale is — and the wash is a locator under a marker, not a plan.
 * The boundary is the part that survives being small, so it keeps most of the
 * opacity, exactly as `adsUrbanisme.js` found for its emprises.
 *
 * ONE PLOT, ONE COLOUR, AND IT IS THE MOST RECENT SALE'S. Several mutations
 * on one plot is the normal case and they are not contemporaries; this is the
 * same reduction {@link dvfMostRecentSale} makes for a building volume, and
 * it is the same function, so a plot and the volume standing on it can never
 * be painted from two different transactions.
 */
const PARCEL_FILL_ALPHA = 0.2;
const PARCEL_OUTLINE_ALPHA = 0.85;
const PARCEL_OUTLINE_WIDTH_PX = 1.4;

/**
 * Marker size, in CSS px. A sale with a comparable ratio is the one worth
 * reading, so it gets the pixels; a neutral one still has to be visible enough
 * to click, because WHY it has no ratio is on its card.
 */
const SIZE_COMPARABLE_PX = 19;
const SIZE_NO_RATIO_PX = 15;

/**
 * The sale happened, the register cannot price it. Measured ΔE76 35.6 from the
 * nearest "no data" wash of `buildingTheme.js` and 45.7 from the nearest class
 * of the ramp below — see the header for why it is no longer `#7c8aa0`.
 */
export const COLOR_NO_RATIO = '#9aa7bd';

/**
 * The sale has a €/m² and there is no commune median to divide it by. Provably
 * unreachable with a well-formed payload (see the header); painted loudly
 * rather than folded into {@link COLOR_NO_RATIO}, because A1 does not allow one
 * sign for two different admissions.
 */
export const COLOR_NO_BASIS = '#c46be0';

/**
 * The frozen class breaks, in RATIO to the commune median — domain thresholds,
 * published, never quantiles of whatever is on screen (C1).
 *
 * ±5 % is the band inside which two flats in the same street are the same
 * price; ±25 % is where a buyer stops calling it a variation and starts asking
 * what is wrong with it. Five classes, not seven: B3 caps what a reader can
 * separate, and these five measure ΔE76 26.0 (amber/yellow) to 57.4
 * (green/teal) apart, all above the ~10 at which two colours stop sharing a
 * name.
 *
 * Diverging on purpose, and centred on the reference rather than on a range:
 * teal below, yellow at the median, red above. The lightness peak sits at the
 * centre class, which is what a diverging ramp is supposed to do — the ORDER a
 * reader has to recover here is "away from the reference, in which direction",
 * not "more of something".
 */
export const DVF_RATIO_BREAKS = Object.freeze([1.25, 1.05, 0.95, 0.75]);

/** @type {ReadonlyArray<{id: string, min: number, color: string, label: string, blurb: string}>} */
export const DVF_RATIO_CLASSES = Object.freeze([
  Object.freeze({
    id: 'very-high',
    min: 1.25,
    color: '#ff6b4a',
    label: '+25 % et plus',
    blurb: 'Au moins un quart au-dessus du médian de la commune.',
  }),
  Object.freeze({
    id: 'high',
    min: 1.05,
    color: '#ffb03d',
    label: '+5 à +25 %',
    blurb: 'Au-dessus du médian de la commune, hors de la bande d’équivalence.',
  }),
  Object.freeze({
    id: 'at-median',
    min: 0.95,
    color: '#ffe066',
    label: '−5 à +5 % — au médian',
    blurb: 'Dans les 5 % du médian de la commune : le prix courant du territoire.',
  }),
  Object.freeze({
    id: 'low',
    min: 0.75,
    color: '#7ed957',
    label: '−25 à −5 %',
    blurb: 'Sous le médian de la commune, hors de la bande d’équivalence.',
  }),
  Object.freeze({
    id: 'very-low',
    min: -Infinity,
    color: '#3dd6c4',
    label: 'moins de −25 %',
    blurb: 'Au moins un quart sous le médian de la commune.',
  }),
]);

/**
 * The €/m² a colour may be computed from, or null.
 *
 * `prixM2` is already null for everything `dvfFeed.js` refuses to price. The
 * one thing left to refuse here is a ratio of zero: a mutation declared at
 * €0 divides to 0 €/m², which is a finite number the ramp would happily paint
 * as "75 % below the commune" — the same shape of error as the €2,295 swap the
 * feed already rejects. No captured row shows it; the guard is one comparison.
 * @param {?object} sale
 * @returns {?number}
 */
export function saleRatioPrice(sale) {
  const value = sale?.prixM2;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The class a price falls in, against a NAMED reference median.
 * @param {?number} prixM2
 * @param {?number} referenceMedian The commune median. Never a viewport median.
 * @returns {?object} One of {@link DVF_RATIO_CLASSES}, or null.
 */
export function saleRatioClass(prixM2, referenceMedian) {
  if (!(typeof prixM2 === 'number' && Number.isFinite(prixM2) && prixM2 > 0)) return null;
  if (!(typeof referenceMedian === 'number' && Number.isFinite(referenceMedian)
    && referenceMedian > 0)) return null;
  const ratio = prixM2 / referenceMedian;
  return DVF_RATIO_CLASSES.find((entry) => ratio >= entry.min) || null;
}

/**
 * The CSS colour of a sale.
 *
 * THREE outcomes, three signs (A1): a price class, "sold but not priceable",
 * and "priced but nothing named to divide by".
 * @param {?number} prixM2
 * @param {?number} referenceMedian Commune median, from `summary.reference`.
 * @returns {string} `#rrggbb`
 */
export function saleColorCss(prixM2, referenceMedian) {
  if (!(typeof prixM2 === 'number' && Number.isFinite(prixM2) && prixM2 > 0)) return COLOR_NO_RATIO;
  const klass = saleRatioClass(prixM2, referenceMedian);
  return klass ? klass.color : COLOR_NO_BASIS;
}

/**
 * The Cesium colour of a sale marker.
 * @param {?number} prixM2
 * @param {?number} referenceMedian Commune median. NOT the median on screen.
 * @returns {object} Cesium colour.
 */
export function saleColor(prixM2, referenceMedian) {
  return Cesium.Color.fromCssColorString(saleColorCss(prixM2, referenceMedian));
}

/** Format a euro amount the way a French reader expects to see it. */
function euros(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('fr-FR')} €` : '—';
}

/** Format a €/m² the way a French reader expects to see it. */
function eurosPerM2(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString('fr-FR')} €/m²` : '—';
}

/** `1,39` — two decimals, French separator. */
function ratioText(ratio) {
  return ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Name the editions the reference was computed over.
 * @param {Array<number>} years
 * @returns {?string}
 */
export function dvfYearsLabel(years) {
  const list = [...new Set((Array.isArray(years) ? years : [])
    .map((year) => Number.parseInt(year, 10))
    .filter((year) => Number.isFinite(year)))].sort((a, b) => a - b);
  if (!list.length) return null;
  if (list.length === 1) return `édition ${list[0]}`;
  const contiguous = list[list.length - 1] - list[0] === list.length - 1;
  return contiguous
    ? `éditions ${list[0]} à ${list[list.length - 1]}`
    : `éditions ${list.join(', ')}`;
}

/**
 * The denominator, resolved and named, from the payload the proxy served.
 *
 * `basis` is one of `'commune'` (a median exists), `'none'` (the editions hold
 * no comparable at all) or `'absent'` (the payload carries no reference block —
 * an older cached answer). None of the three is allowed to fall back to the
 * median of what is on screen; the last two colour nothing and say so.
 * @param {?object} payload
 * @returns {object}
 */
export function dvfReference(payload) {
  const raw = payload?.summary?.reference || null;
  const median = typeof raw?.medianPrixM2 === 'number' && Number.isFinite(raw.medianPrixM2)
    && raw.medianPrixM2 > 0
    ? raw.medianPrixM2
    : null;
  const name = raw?.name || payload?.commune?.name || null;
  const code = raw?.code || payload?.commune?.code || null;
  const territory = name || (code ? `commune ${code}` : null);
  const yearsLabel = dvfYearsLabel(payload?.years);
  return {
    basis: raw ? (median === null ? 'none' : 'commune') : 'absent',
    medianPrixM2: median,
    name,
    code,
    territory,
    yearsLabel,
    comparableCount: Number.isFinite(raw?.comparableCount) ? raw.comparableCount : 0,
    count: Number.isFinite(raw?.count) ? raw.count : 0,
    unplacedCount: Number.isFinite(raw?.unplacedCount) ? raw.unplacedCount : 0,
    p25PrixM2: Number.isFinite(raw?.p25PrixM2) ? raw.p25PrixM2 : null,
    p75PrixM2: Number.isFinite(raw?.p75PrixM2) ? raw.p75PrixM2 : null,
    /** The sentence that has to travel with every colour this layer draws. */
    label: median === null
      ? (raw
        ? `Aucun médian pour ${territory || 'cette commune'} : rien à rapporter`
        : 'Dénominateur indisponible : rien à rapporter')
      : `Médian de ${territory || 'la commune'} ${eurosPerM2(median)}`,
  };
}

/**
 * The class breaks restated in €/m² at the current reference.
 *
 * D2 asks for bounds a reader can hold. `≥ 1,25 ×` is the frozen rule; `≥
 * 11 195 €/m²` is what the rule means here, and only the second one can be
 * compared to a listing.
 * @param {?number} referenceMedian
 * @param {object} klass One of {@link DVF_RATIO_CLASSES}.
 * @returns {?string}
 */
export function classBoundsText(referenceMedian, klass) {
  if (!(typeof referenceMedian === 'number' && referenceMedian > 0)) return null;
  const index = DVF_RATIO_CLASSES.indexOf(klass);
  const upper = index > 0 ? DVF_RATIO_CLASSES[index - 1].min : null;
  const lower = Number.isFinite(klass.min) ? klass.min : null;
  const lo = lower === null ? null : Math.round(referenceMedian * lower);
  const hi = upper === null ? null : Math.round(referenceMedian * upper);
  if (lo === null) return `moins de ${eurosPerM2(hi)}`;
  if (hi === null) return `${eurosPerM2(lo)} et plus`;
  return `${lo.toLocaleString('fr-FR')} à ${eurosPerM2(hi)}`;
}

/**
 * The sentence that frames the classes: what they are divided by, over what,
 * and by what rule.
 *
 * It is the `legendNote` slot rather than a first entry of the key, and that
 * is the whole of the D1 argument applied honestly. The denominator is not a
 * CLASS — nothing on the map is painted in it — so printing it as a row with
 * an empty swatch and a six-line paragraph made the key open on something a
 * reader has to scroll past to reach the colours. Above the classes, in one
 * line, it does the same job in a tenth of the height.
 *
 * @param {object} reference From {@link dvfReference}.
 * @returns {string}
 */
export function dvfLegendNote(reference, { parcels = 0 } = {}) {
  const line = [
    reference.label,
    reference.yearsLabel,
    // The frozen rule, said once. Without it the €/m² bounds below read as
    // quantiles of what is on screen, which is exactly what C1 forbids and
    // exactly what this layer stopped doing on 2026-09-03.
    'classes gelées à ±5 % et ±25 % de ce médian',
  ].filter(Boolean).join(' · ');
  // WHAT THE TINTED GROUND IS. The plots wear the same ramp as the markers —
  // one channel, one information — so they need no class of their own; what
  // they need is the sentence that says they are plots, and which of several
  // mutations each one is showing. Only when there are any: a commune Etalab
  // publishes no cadastre for must not be told it is looking at parcels.
  return parcels > 0 ? `${line} · sol teinté = la parcelle vendue` : line;
}

/**
 * The A5 slot: what this answer had to leave out, in one sentence.
 *
 * Three admissions used to be three legend rows with a paragraph each — the
 * scan radius buried inside the denominator's blurb, the clipping, and the
 * mutations the register publishes with no coordinate. They are not classes
 * and they were pushing the classes off the panel. They are still all here,
 * still all counted, on the line that is FOR what a key had to leave out.
 *
 * @param {object} reference From {@link dvfReference}.
 * @param {object} summary `payload.summary`.
 * @param {number} drawn How many sales were actually drawn.
 * @param {{filter?: string, hidden?: number}} [options] The type filter in
 *   force and how many served mutations it took off the map. A filter is the
 *   loudest reason a count on the row disagrees with the register, so it is
 *   the first thing this line says.
 * @returns {string}
 */
export function dvfLegendDisclosure(reference, summary, drawn, options = {}) {
  const parts = [];
  // A4: this silence has a cause, and it is not "these sales bought no
  // ground". Only said when the register DID name plots and the cadastre
  // could not return them — an answer with no `parcels` key at all is an
  // older cached payload, not a failure to report.
  if (Array.isArray(options.parcels) && options.parcels.length === 0 && drawn > 0) {
    parts.push('parcelles indisponibles pour cette commune : les ventes sont dessinées, le sol '
      + 'qu’elles ont acheté ne l’est pas');
  }
  const filter = DVF_TYPE_FILTERS.find((entry) => entry.id === options.filter);
  if (filter && filter.id !== 'tous' && options.hidden > 0) {
    parts.push(`filtre « ${filter.label} » : ${options.hidden} autre(s) mutation(s) non `
      + 'dessinée(s), que le médian de référence compte quand même');
  }
  parts.push(`rayon ${SCAN_RADIUS_M} m`);
  if (summary?.truncated) {
    parts.push(`écrêté à ${drawn} sur ${summary.count}, les plus proches`);
  }
  if (reference.unplacedCount > 0) {
    parts.push(`${reference.unplacedCount} mutation(s) sans coordonnée publiée, comptée(s) dans `
      + 'le médian et impossibles à dessiner');
  }
  const line = parts.join(' · ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * The key to the ramp (D1) — the CLASSES, and nothing that is not one.
 *
 * ── WHY THIS IS SHORTER THAN IT WAS, AND WHAT DID NOT LEAVE ────────────────
 *
 * Measured on Bayonne, 2026-09-14: ten entries, each with a paragraph under
 * it, filling the whole right rail and running off the bottom of the screen
 * before the Avis de valeur block underneath had shown its first line. Every
 * sentence in it was true and most of them were the wrong sentence to put in
 * front of somebody who had just switched the layer on. D1's test is « sans
 * ouvrir aucun panneau, l'utilisateur peut-il traduire une couleur en
 * valeur ? » — and a key you have to READ for a minute fails it as surely as
 * one that is hidden.
 *
 * So the key now holds exactly the six things that are painted, and the three
 * that were never classes moved to the two slots that exist for them:
 *
 *   · the DENOMINATOR and the frozen rule → {@link dvfLegendNote}, the block's
 *     own line, printed ABOVE the classes it divides;
 *   · the radius, the clipping and the mutations with no coordinate →
 *     {@link dvfLegendDisclosure}, the A5 line under the classes;
 *   · each class's sentence → its tooltip, which is where `_refreshMapLegend`
 *     puts a blurb once entries sit side by side.
 *
 * Nothing was deleted. The layer says the same things in a fifth of the
 * height, and the classes are visible without scrolling, which is the whole
 * of what the key is for.
 *
 * ── THE LABELS ARE €/m², NOT RATIOS ────────────────────────────────────────
 *
 * `+25 % et plus · 5 164 €/m² et plus` was both bounds on one line and it was
 * the longest line in the block. D2 asks for bounds a reader can hold, and of
 * those two only the second can be compared to a listing. The ratio is not
 * lost: the rule that produced it is stated once in the note above, where it
 * belongs — it is a property of the whole ramp, not of one class.
 *
 * `counts` is supplied when the caller knows what was drawn (the layer's own
 * row, counting SALES) and omitted when `buildingTheme.js` will fill it in by
 * matching swatch to painted colour (the Bâti 3D row, counting VOLUMES). Same
 * ramp, two populations, and neither of them invented.
 * @param {object} reference From {@link dvfReference}.
 * @param {?Map<string, number>} counts class id → count, or null.
 * @returns {Array<object>}
 */
export function dvfLegendEntries(reference, counts = null) {
  const entries = [];
  for (const klass of DVF_RATIO_CLASSES) {
    const bounds = classBoundsText(reference.medianPrixM2, klass);
    const entry = {
      label: bounds || klass.label,
      color: klass.color,
      // The ratio leads the tooltip, because that is the class's DEFINITION
      // and the label is only what it means at today's reference.
      blurb: `${klass.label} — ${klass.blurb}`,
    };
    if (counts) entry.count = counts.get(klass.id) || 0;
    entries.push(entry);
  }
  const neutral = {
    label: 'sans prix au m²',
    color: COLOR_NO_RATIO,
    blurb: 'Mutation qui a acheté autre chose qu’un seul logement — un immeuble de 179 lots, '
      + 'un appartement avec un commerce — ou un échange. Le registre ne dit pas comment le '
      + 'prix se répartit, donc rien n’est peint : la vente est dessinée, pas évaluée.',
  };
  if (counts) neutral.count = counts.get('no-ratio') || 0;
  entries.push(neutral);
  if (counts && (counts.get('no-basis') || 0) > 0) {
    entries.push({
      label: 'sans médian de référence',
      color: COLOR_NO_BASIS,
      count: counts.get('no-basis') || 0,
      blurb: 'Un prix au m² sans commune à le rapporter. Cet état ne devrait pas exister — '
        + 'les ventes servies sont un sous-ensemble des mutations dont le médian est calculé — '
        + 'et il est peint plutôt que masqué pour qu’il ne passe jamais pour une classe de prix.',
    });
  }
  return entries;
}

/**
 * Compare two mutations by how recent they are. See the header for why recency
 * is the reduction and not the median.
 * @returns {number} > 0 when `a` is the more recent.
 */
function byRecency(a, b) {
  const dateA = String(a?.date || '');
  const dateB = String(b?.date || '');
  // ISO `YYYY-MM-DD`, so a string compare IS a date compare. An empty date
  // sorts below every real one rather than throwing the sale away.
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const surfaceA = Number.isFinite(a?.dwellingSurface) ? a.dwellingSurface : 0;
  const surfaceB = Number.isFinite(b?.dwellingSurface) ? b.dwellingSurface : 0;
  if (surfaceA !== surfaceB) return surfaceA - surfaceB;
  const idA = String(a?.id || '');
  const idB = String(b?.id || '');
  return idA === idB ? 0 : (idA < idB ? -1 : 1);
}

/**
 * N sales on one building → the one the volume speaks for.
 * @param {Array<object>} sales
 * @returns {?object}
 */
export function dvfMostRecentSale(sales) {
  let best = null;
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale) continue;
    if (!best || byRecency(sale, best) > 0) best = sale;
  }
  return best;
}

/* ── the building theme ────────────────────────────────────────────────── */

/**
 * Lower than the default 100 and lower than the permit registers, higher than
 * DPE: when a reader turns on both the energy label and the price, the label is
 * the rarer, more legally loaded reading and keeps the volumes. The number is
 * the layer's claim on the geometry, not a ranking of the datasets.
 */
export const DVF_THEME_PRECEDENCE = 20;

/** The payload the theme currently speaks for, so `enable()` can republish. */
let _themePayload = null;
let _themeEnabled = false;

/**
 * The type filter in force, mirrored out of the shell's runtime.
 *
 * WRITTEN FROM `render`, WHICH IS THE ONLY PLACE THAT CANNOT BE LATE. The
 * first version mirrored it from `rowControls` and drew every filter change
 * one click behind: `setParams` redraws immediately, `rowControls` runs on the
 * next panel refresh, and those are two different ticks. Measured in Bayonne —
 * « Maisons » pressed and 397 flats still on screen, then « Toutes » pressed
 * and the single house appearing.
 *
 * It is mirrored at all because the THEME has no call frame of its own: it is
 * republished from `enable()` and from the registry's notifications, with no
 * runtime in reach, and a theme painting a different subset from the markers
 * above it would put the row, the key and the city in three populations.
 */
let _typeFilter = 'tous';

/**
 * Publish (or withdraw) the theme for the payload in hand.
 *
 * Withdrawing rather than publishing an empty theme is deliberate: a registered
 * theme with no points washes the WHOLE city to near-grey and labels it "sans
 * mutation", which is a statement about the register. When this layer is off,
 * or dormant above its altitude ceiling, it has nothing to say and must hand
 * the volumes back.
 *
 * Nothing here imports the BD TOPO layer. `registerBuildingTheme` notifies it,
 * it repaints itself, and it stops when the theme is cleared — one direction,
 * so a theme can never leave the city painted after its layer is switched off.
 */
/** Take-down for the per-parcel offer. Null while nothing is offered. */
let _unpublishByParcel = null;

/**
 * Offer the sales this scan already holds, keyed on the parcel they name.
 *
 * The building layer's card asks for "the last sale on this ground" and the
 * answer is ALREADY IN MEMORY: `id_parcelle` travels on every projected
 * mutation, and a BD TOPO volume resolves to the same 14-character id through
 * the RNB. So the join is a lookup, not a second scan of the register — and it
 * is offered rather than imported, so a reader who closes this row takes the
 * line off that card and nothing else changes.
 *
 * WHAT IT IS NOT is a claim about the parcel's whole history: the scan is a
 * disc of {@link SCAN_RADIUS_M} around one point over a bounded run of years,
 * so "no sale" here means "none in what was scanned" — which is why the line
 * exists only when there IS one.
 */
function publishByParcel() {
  const sales = _themeEnabled ? filterSalesByType(_themePayload?.sales, _typeFilter) : [];
  if (!sales.length) {
    _unpublishByParcel?.();
    _unpublishByParcel = null;
    return;
  }
  const byParcel = new Map();
  for (const sale of sales) {
    const key = String(sale?.parcelle || '').trim();
    if (!key) continue;
    const held = byParcel.get(key);
    // Most recent wins. `date` is ISO, so a string compare is a date compare.
    if (!held || String(sale.date || '') > String(held.date || '')) byParcel.set(key, sale);
  }
  _unpublishByParcel?.();
  _unpublishByParcel = publishJoin('dvf/byParcel', (parcelId) => (
    byParcel.get(String(parcelId || '').trim()) || null
  ));
}

function publishTheme() {
  publishByParcel();
  if (!_themeEnabled || !_themePayload) {
    clearBuildingTheme(DVF_LAYER_ID);
    return false;
  }
  const reference = dvfReference(_themePayload);
  // THE SAME SUBSET THE MARKERS DRAW. A filter the volumes did not honour
  // would put the row, the key and the city in three different populations —
  // « Appart. » lit, forty markers on screen, and a hundred and seventy
  // volumes painted from the houses that were filtered out of the count
  // beside them.
  const sales = filterSalesByType(_themePayload.sales, _typeFilter);
  registerBuildingTheme({
    id: DVF_LAYER_ID,
    label: 'Ventes DVF (€/m²)',
    precedence: DVF_THEME_PRECEDENCE,
    points: sales,
    reduce: dvfMostRecentSale,
    colorFor: (sale) => saleColorCss(saleRatioPrice(sale), reference.medianPrixM2),
    legend: dvfLegendEntries(reference),
    // The denominator travels WITH the swatches, because the row that prints
    // them is not this one: Bâti 3D borrows the ramp, and a ramp of ratios
    // with no named reference territory is unreadable there in exactly the
    // way it would be here.
    legendNote: dvfLegendNote(reference),
    // NOT "sans mutation". The scan asks the register about a 300 m disc while
    // BD TOPO loads volumes over a box up to 9 km wide, so most unpainted
    // volumes were never asked about at all. Labelling them "no sale recorded"
    // would turn the layer's own reach into a statement about the market —
    // the exact shape of A1, applied to a whole city block.
    unknownLabel: `hors du rayon de ${SCAN_RADIUS_M} m ou sans mutation`,
  });
  return true;
}

/**
 * Positions for one ring, closed. Three points is the least that encloses
 * anything; the same helper the other ground-polygon layers keep.
 * @param {Array<number[]>} ring
 * @returns {?Array<object>}
 */
function ringPositions(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return Cesium.Cartesian3.fromDegreesArray(ring.flat());
}

/**
 * Wash the plots the drawn sales name, under the markers.
 *
 * The fill and the outline are SEPARATE entities because a ground-clamped
 * `polygon` cannot draw its own stroke in Cesium — `outline: true` is silently
 * ignored once the polygon is classified. Both carry the same name and
 * description, so the edge of a plot opens the same card as its middle.
 *
 * Exported for its own test: "the plot is painted by its most recent sale, and
 * an unsold plot is not drawn at all" is the contract, and a later
 * simplification to "colour by whatever came first" would undo it silently.
 *
 * @param {object} dataSource
 * @param {Array<object>} parcels `[{id, parts}]` from the proxy.
 * @param {Array<object>} sales The sales that were actually DRAWN.
 * @param {object} reference From {@link dvfReference}.
 * @param {number} classificationType Cesium surface to clamp onto.
 * @returns {number} Plots drawn.
 */
export function drawDvfParcels(dataSource, parcels, sales, reference, classificationType) {
  const list = Array.isArray(parcels) ? parcels : [];
  if (!list.length) return 0;
  const byParcel = new Map();
  for (const sale of sales) {
    const key = String(sale?.parcelle || '').trim();
    if (!key) continue;
    const held = byParcel.get(key);
    if (held) held.push(sale); else byParcel.set(key, [sale]);
  }
  let drawn = 0;
  for (const parcel of list) {
    // A plot whose every sale was filtered out is ground with nothing to say.
    // Not drawn: a wash with no marker on it reads as a sale the card cannot
    // open — the same rule `adsUrbanisme.js` applies to an emprise with no
    // dossier left in the served cut.
    const sale = dvfMostRecentSale(byParcel.get(parcel.id) || []);
    if (!sale) continue;
    const price = saleRatioPrice(sale);
    const css = saleColorCss(price, reference.medianPrixM2);
    const fill = Cesium.Color.fromCssColorString(css).withAlpha(PARCEL_FILL_ALPHA);
    const stroke = Cesium.Color.fromCssColorString(css).withAlpha(PARCEL_OUTLINE_ALPHA);
    const name = sale.address || sale.commune || 'Parcelle';
    const description = [
      `parcelle ${parcel.id}`,
      sale.date,
      euros(sale.valeur),
      price === null ? 'pas de €/m² comparable' : eurosPerM2(price),
      'dernière mutation connue de cette parcelle dans le rayon scruté',
    ].filter(Boolean).join(' · ');
    for (const [index, rings] of (parcel.parts || []).entries()) {
      const outer = ringPositions(rings[0]);
      if (!outer) continue;
      const holes = [];
      for (let h = 1; h < rings.length; h += 1) {
        const hole = ringPositions(rings[h]);
        // A courtyard is not part of the plot. Filled in, the wash would claim
        // ground the sale did not buy.
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      dataSource.entities.add({
        id: `dvf-parcel:${parcel.id}:${index}`,
        name,
        description,
        properties: { kind: 'dvf-parcel', parcelle: parcel.id, saleId: sale.id },
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(outer, holes),
          material: fill,
          classificationType,
          outline: false,
        },
      });
      for (const [ringIndex, ring] of rings.entries()) {
        const positions = ringPositions(ring);
        if (!positions) continue;
        dataSource.entities.add({
          id: `dvf-parcel:${parcel.id}:${index}:${ringIndex}`,
          name,
          description,
          polyline: {
            positions: [...positions, positions[0]],
            width: PARCEL_OUTLINE_WIDTH_PX,
            material: new Cesium.ColorMaterialProperty(stroke),
            clampToGround: true,
            classificationType,
          },
        });
      }
    }
    drawn += 1;
  }
  return drawn;
}

/**
 * One mutation's card.
 *
 * `type_local` LEADS THE SECOND HALF OF IT, and it used to be on no card at
 * all. The map draws flats, houses, shops, cellars and bare land in one
 * vocabulary of dots; a reader looking at a dense city centre had no way to
 * find out which, and that is exactly how 257 Bayonne flats came to be read
 * as houses on 2026-09-14. The register's own wording is used, joined rather
 * than folded: `Appartement + Dépendance` says more than `Appartement` does,
 * and it is the reason the sale below it has no €/m² often enough to matter.
 *
 * @param {object} sale One served mutation.
 * @param {object} reference From {@link dvfReference}.
 * @returns {string}
 */
export function dvfSaleCard(sale, reference) {
  const price = saleRatioPrice(sale);
  const comparable = price !== null;
  const ratio = comparable && reference.medianPrixM2 ? price / reference.medianPrixM2 : null;
  return [
    sale.date,
    sale.nature,
    euros(sale.valeur),
    (sale.types || []).join(' + ') || 'type non publié',
    comparable ? eurosPerM2(price)
      // Saying WHY there is no ratio is the point of drawing it neutral.
      : sale.dwellingCount > 1 ? `${sale.dwellingCount} logements — pas de €/m² comparable`
        : 'pas de €/m² comparable',
    // The denominator travels with every single card, never only with the
    // legend: a ratio a reader cannot trace back to a named territory is a
    // decoration.
    ratio === null
      ? (comparable ? reference.label : null)
      : `${ratioText(ratio)} × le médian de ${reference.territory || 'la commune'} `
        + `(${eurosPerM2(reference.medianPrixM2)})`,
    sale.dwellingSurface ? `${sale.dwellingSurface} m²` : null,
    Number.isFinite(sale.distanceM) ? `${sale.distanceM} m` : null,
  ].filter(Boolean).join(' · ');
}

/** Count the drawn sales by the class they were painted in. */
function countByClass(sales, referenceMedian) {
  const counts = new Map();
  for (const sale of sales || []) {
    const price = saleRatioPrice(sale);
    if (price === null) {
      counts.set('no-ratio', (counts.get('no-ratio') || 0) + 1);
      continue;
    }
    const klass = saleRatioClass(price, referenceMedian);
    const key = klass ? klass.id : 'no-basis';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * One drawn mutation as a plain record the analyst engine can query.
 *
 * `prixM2` is carried EXACTLY as the register supports it — null for every
 * mutation `dvfFeed.js` refuses to price (a block sale, a flat sold with a
 * shop). That null is the whole point: the engine drops non-finite values from
 * min/max, so a €32,000,000 building spread over 179 lots can never enter a
 * price answer, while the sale itself still counts as a sale. `priced` is the
 * same fact as a flag, so "the sales that have a price per square metre" is a
 * filter rather than a thing the model has to infer from a missing field.
 *
 * @param {object} sale One entry of the proxy's `sales` array.
 * @returns {object|null} A record, or null when it has no position to sit on.
 */
export function dvfSaleRecord(sale) {
  if (!sale || !Number.isFinite(sale.lat) || !Number.isFinite(sale.lon)) return null;
  const year = Number(String(sale.date || '').slice(0, 4));
  return {
    id: `dvf:${sale.id}`,
    lat: sale.lat,
    lon: sale.lon,
    prixM2: Number.isFinite(sale.prixM2) ? sale.prixM2 : null,
    valeurEur: Number.isFinite(sale.valeur) ? sale.valeur : null,
    surfaceM2: sale.dwellingSurface > 0 ? sale.dwellingSurface : null,
    rooms: Number.isFinite(sale.rooms) ? sale.rooms : null,
    dwellings: Number.isFinite(sale.dwellingCount) ? sale.dwellingCount : null,
    distanceM: Number.isFinite(sale.distanceM) ? sale.distanceM : null,
    year: Number.isFinite(year) ? year : null,
    date: sale.date || null,
    nature: sale.nature || null,
    propertyType: (sale.types || []).join(', ') || null,
    address: sale.address || null,
    commune: sale.commune || null,
    priced: Number.isFinite(sale.prixM2),
  };
}

/**
 * What this layer has to SAY about the block it just scanned.
 *
 * The numbers are lifted from `getStats()` rather than recomputed, so the
 * sentence the voice speaks and the figures on the panel are the same
 * measurement — the failure this repository keeps guarding against is two
 * honest numbers for one question. Nothing here is derived: the block median,
 * its quartiles and the commune denominator were all computed by the proxy
 * from the rows it parsed, and the voice surface only names them.
 *
 * Null when the layer has nothing to speak for — off, or dormant above its
 * altitude ceiling — because "no median" and "a median of nothing" are
 * different statements and only the first one is true.
 *
 * `pending` is the third state and it earns its own field. A layer switched on
 * a second ago has not scanned yet, and the absence of a summary reads exactly
 * like "this place has no data": measured on a live session, the model was
 * asked for the price at an address it had just flown to and answered that the
 * layers "ne remontent aucune donnée", half a second before they did.
 *
 * @param {object|null} stats The layer's own `getStats()` output.
 * @returns {object|null} Named, speakable fields, or null.
 */
export function dvfVoiceSummary(stats) {
  if (!stats || stats.dormant) return null;
  // THE CELL REGIME NEEDS ITS OWN SENTENCE, and this is not a nicety. Left to
  // fall through, a box answer would have been published with
  // `radiusM: SCAN_RADIUS_M` beside it — a caller would have said "sur les
  // 300 m autour de vous" about ground two kilometres across. The regime is
  // named, the reach is the box, and the per-sale list is declared ABSENT
  // rather than empty: `getAnalystRecords` returns nothing up here, and a
  // caller that read that as "no sales" would be inverting the answer.
  if (stats.scanBasis === 'cells') {
    return {
      subject: 'ventes immobilières publiées au registre DVF',
      basis: 'cells',
      measuredAt: stats.scanCentre ? { ...stats.scanCentre } : null,
      communes: stats.communes ?? null,
      years: stats.years ?? null,
      cellSizeM: stats.cellSizeM ?? null,
      salesInView: stats.salesFound ?? 0,
      pricedSales: stats.comparableCount ?? 0,
      viewMedianPrixM2: stats.localMedianPrixM2 ?? null,
      // One per commune, because the colours were read against several.
      communeReferences: stats.references ?? null,
      note: 'The camera is high enough that this layer answers by AREA, not by '
        + 'sale: it holds cells, not a list of mutations, so there is nothing to '
        + 'rank or to quote a single price from. Say the view median with the '
        + 'communes behind it. For one property, fly below '
        + `${SCAN_CELL_MIN_ALTITUDE_M} m and ask again.`,
    };
  }
  if (!Number.isFinite(stats.salesFound)) {
    return {
      subject: 'ventes immobilières publiées au registre DVF',
      pending: true,
      note: 'The register has not answered for this point yet. Say the reading is '
        + 'coming and ask again in a moment — this is NOT "no sales here".',
    };
  }
  return {
    subject: 'ventes immobilières publiées au registre DVF',
    // WHERE it was measured, not just what. A scan does not clear on arrival:
    // fly from Paris to Bordeaux and this summary describes the Paris block
    // until the new answer lands, and a caller with no way to tell would quote
    // one city's median over another's roofs.
    measuredAt: stats.scanCentre ? { ...stats.scanCentre } : null,
    commune: stats.commune ?? null,
    years: stats.years ?? null,
    radiusM: SCAN_RADIUS_M,
    salesInRadius: stats.salesFound,
    salesDrawn: stats.count ?? 0,
    // The gap between these two is what makes the median honest, so it travels
    // with it: a block of 255 sales of which 96 can carry a price per square
    // metre is not a block of 255 prices.
    pricedSales: stats.comparableCount ?? 0,
    truncated: stats.truncated === true,
    blockMedianPrixM2: stats.localMedianPrixM2 ?? null,
    blockP25PrixM2: stats.p25PrixM2 ?? null,
    blockP75PrixM2: stats.p75PrixM2 ?? null,
    // The denominator the colours are read against, named — a ratio whose
    // reference territory is not stated is not a measurement (see the header).
    communeMedianPrixM2: stats.referenceMedianPrixM2 ?? null,
    communeReference: stats.referenceLabel ?? null,
  };
}

/**
 * The disc's ink, and it is lighter than the parcel wash next door.
 *
 * A cell covers a whole block where a parcel covers one plot, so the same alpha
 * would put four times the ink on the screen for the same claim. 0.15 with a
 * firm edge keeps the basemap legible under a field of discs — the rule
 * `filosofiCarreaux.js` states as "a layer that hides the map is not a layer,
 * it is a replacement" — while the boundary, which is the part that survives
 * being small, keeps most of the opacity.
 */
const CELL_FILL_ALPHA = 0.15;
/**
 * Whether the answer ON SCREEN is a field of cells.
 *
 * Written by `render` from the payload and read by `minShiftKm`, never derived
 * from the camera: the two disagree for exactly as long as a scan is in flight,
 * and during that window the threshold has to describe what is drawn.
 */
let _cellMode = false;
const CELL_OUTLINE_ALPHA = 0.8;
const CELL_OUTLINE_WIDTH_PX = 1.4;

/** French plural with a thousands-separated count. */
function plural(n, singular, pluralForm = `${singular}s`) {
  return `${Number(n || 0).toLocaleString('fr-FR')} ${n > 1 ? pluralForm : singular}`;
}

/* ── the cell regime ───────────────────────────────────────────────────── */
/**
 * Above 600 m this layer stops drawing one mark per sale and draws one disc per
 * patch of ground. See `scanRegime.js` for the switch and the measurement that
 * forced it; what follows is only what the mark looks like and what it claims.
 *
 * THE COLOUR LANGUAGE DOES NOT CHANGE, and that is the point of doing it this
 * way. A cell is painted from {@link DVF_RATIO_CLASSES} — the same five frozen
 * bands around the same reference — so a reader who learned the ramp at street
 * level reads the same ramp from altitude. Only the UNIT moves: one sale
 * becomes the median of a cell's sales.
 *
 * WHAT A CELL IS COLOURED BY IS A MEDIAN OF RATIOS, NOT A RATIO OF MEDIANS.
 * A box straddles communes — 0.02° at Lyon spans two arrondissements, and each
 * publishes its own median — so every sale is divided by ITS OWN commune's
 * denominator in the proxy and the cell takes the median of those quotients.
 * Dividing a cell's median price by one blended commune median instead would
 * paint Villeurbanne against Lyon 6e's prices and call the difference a market.
 *
 * @param {?number} ratio A sale's price over its own commune's median.
 * @returns {?object} One of {@link DVF_RATIO_CLASSES}, or null.
 */
export function dvfCellClass(ratio) {
  if (!(typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0)) return null;
  return DVF_RATIO_CLASSES.find((entry) => ratio >= entry.min) || null;
}

/** The CSS colour of a cell. Neutral when the register priced nothing in it. */
export function dvfCellColorCss(cell) {
  const klass = dvfCellClass(cell?.medianRatio);
  return klass ? klass.color : COLOR_NO_RATIO;
}

/**
 * The reference a cell key is read against, shaped like {@link dvfReference}
 * so the legend builders take it unchanged.
 *
 * `medianPrixM2` IS DELIBERATELY NULL HERE, and it is not a missing value. The
 * box has as many denominators as it has communes, so there is no single €/m²
 * the class breaks can be restated in — and `dvfLegendEntries` already falls
 * back to the RATIO labels ("+25 % et plus") when it has no median, which is
 * the only honest label for a key with two references behind it. The
 * denominators are not hidden: they are named one by one in the note.
 *
 * @param {object} payload
 * @returns {object}
 */
export function dvfCellReference(payload) {
  const references = payload?.summary?.references || [];
  const named = references.filter((entry) => Number.isFinite(entry?.medianPrixM2));
  return {
    basis: named.length ? 'communes' : 'none',
    medianPrixM2: null,
    name: null,
    code: null,
    territory: null,
    yearsLabel: dvfYearsLabel(payload?.years),
    comparableCount: references.reduce((sum, entry) => sum + (entry.comparableCount || 0), 0),
    count: references.reduce((sum, entry) => sum + (entry.count || 0), 0),
    unplacedCount: 0,
    p25PrixM2: null,
    p75PrixM2: null,
    references: named,
    label: named.length
      ? `Chaque cellule est rapportée au médian de SA commune (${named.length})`
      : 'Aucun médian communal : rien à rapporter',
  };
}

/** class id → number of CELLS, for the key's bar. */
export function countCellsByClass(cells) {
  const counts = new Map();
  for (const cell of cells || []) {
    const klass = dvfCellClass(cell?.medianRatio);
    const id = klass ? klass.id : 'no-ratio';
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

/**
 * The note above the key in cell mode: what the colours are divided by, named.
 *
 * EVERY DENOMINATOR, NOT A COUNT OF THEM. "Rapporté au médian de sa commune"
 * without the medians is the failure this layer's header spends a paragraph
 * on — a ratio whose denominator is not written down is not a measurement — so
 * the communes are printed with their €/m², busiest first, capped at four
 * because a key is not a table.
 *
 * @param {object} payload @returns {string}
 */
export function dvfCellLegendNote(payload) {
  const reference = dvfCellReference(payload);
  const named = reference.references.slice(0, 4)
    .map((entry) => `${entry.name || entry.code} ${eurosPerM2(entry.medianPrixM2)}`);
  const more = reference.references.length - named.length;
  const line = [
    named.length
      ? `Rapporté au médian de chaque commune : ${named.join(' · ')}${more > 0 ? ` · +${more}` : ''}`
      : reference.label,
    reference.yearsLabel,
    'classes gelées à ±5 % et ±25 % de ce médian',
    // WHAT THE DISC IS, in the words `filosofiCarreaux.js` uses for the same
    // mark: the colour is the price and the AREA is how many sales stand
    // behind it. Without this line a big pale disc and a small vivid one read
    // as two prices instead of as two sample sizes.
    'taille du disque = nombre de ventes',
  ].filter(Boolean).join(' · ');
  return line;
}

/**
 * The A5 line in cell mode: the box, the grid, and what the probe could miss.
 * @param {object} payload @returns {string}
 */
export function dvfCellDisclosure(payload) {
  const summary = payload?.summary || {};
  const communes = payload?.communes || [];
  const parts = [];
  const spanKm = payload?.box
    ? ((payload.box.north - payload.box.south) * 110.54).toFixed(1).replace('.', ',')
    : null;
  parts.push(`vue agrégée sur ${spanKm ? `${spanKm} km` : 'la boîte'} de côté, `
    + `cellules de ${summary.cellM || '?'} m`);
  parts.push(`${plural(summary.count || 0, 'vente')} dans la boîte, `
    + `${summary.pricedCount || 0} avec un €/m²`);
  // A4: the commune list comes from probing the box, not from intersecting it —
  // see `boxSamplePoints`. A commune no probe landed in contributes nothing,
  // and its ground is then empty for the same reason a field is.
  if (communes.length) {
    parts.push(`${plural(communes.length, 'commune')} identifiée${communes.length > 1 ? 's' : ''} `
      + `par ${payload.communesProbed || 0} sondages : une commune qu'aucun sondage n'a touchée `
      + 'ne contribue pas');
  }
  if ((payload?.unavailableYears || []).length) {
    parts.push(`millésime(s) non téléchargé(s) : ${payload.unavailableYears.join(', ')}`);
  }
  parts.push(`descendre sous ${SCAN_CELL_MIN_ALTITUDE_M} m pour retrouver chaque vente `
    + 'et sa parcelle');
  const line = parts.join(' · ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * The card a cell opens: what the disc is a median OF.
 * @param {object} cell @param {object} payload @returns {string}
 */
export function dvfCellCard(cell, payload) {
  const klass = dvfCellClass(cell?.medianRatio);
  const reference = (payload?.summary?.references || [])
    .find((entry) => entry.code === cell?.communeCode) || null;
  return [
    `${plural(cell.count, 'vente')} dans cette cellule`,
    cell.pricedCount < cell.count
      ? `${cell.pricedCount} avec un €/m² exploitable`
      : 'toutes avec un €/m² exploitable',
    cell.medianPrixM2 !== null ? `médian ${eurosPerM2(cell.medianPrixM2)}` : null,
    reference
      ? `contre ${eurosPerM2(reference.medianPrixM2)} pour ${reference.name || reference.code}`
      : null,
    klass ? klass.label : 'pas de médian : rien n’est peint',
    (cell.years || []).length ? `millésimes ${cell.years.join(', ')}` : null,
    // The honest ceiling on what this mark can answer, said on the mark itself.
    `descendre sous ${SCAN_CELL_MIN_ALTITUDE_M} m pour voir les ventes une par une`,
  ].filter(Boolean).join(' · ');
}

/**
 * Draw the cells: one translucent disc each, clamped to whatever surface the
 * globe is drawing.
 *
 * CLAMPED LIKE THE PARCELS, NOT LIFTED LIKE THE CARROYAGE. `filosofiFeed.js`
 * lays its discs a computed clearance above a terrain sample because it is
 * drawing a national grid over terrain; this layer already solves the same
 * problem next door with `classificationType`, which paints the surface the
 * globe is ACTUALLY drawing — terrain under a map basemap, the tileset under
 * the photoreal stack. Reusing it here means a cell disc and the parcel wash it
 * turns into on the way down sit on the same ground by construction.
 *
 * @returns {number} Discs drawn.
 */
function drawDvfCells(payload, dataSource, classificationType) {
  const cells = payload?.cells || [];
  const breaks = dvfCellBreaks(payload?.summary?.cellM);
  let drawn = 0;
  for (const cell of cells) {
    const radiusM = cellDiscRadiusM(cell, cell.count, breaks);
    if (!(radiusM > 0)) continue;
    const css = dvfCellColorCss(cell);
    const ring = discRing(cell.lon, cell.lat, radiusM);
    const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
    const klass = dvfCellClass(cell.medianRatio);
    const name = cell.medianPrixM2 !== null
      ? `${eurosPerM2(cell.medianPrixM2)} · ${plural(cell.count, 'vente')}`
      : plural(cell.count, 'vente');
    const description = dvfCellCard(cell, payload);
    dataSource.entities.add({
      id: `dvf-cell:${cell.key}`,
      name,
      description,
      properties: {
        kind: 'dvf-cell',
        count: cell.count,
        pricedCount: cell.pricedCount,
        medianPrixM2: cell.medianPrixM2,
        medianRatio: cell.medianRatio,
        ratioClass: klass ? klass.id : null,
        communeCode: cell.communeCode,
      },
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString(css).withAlpha(CELL_FILL_ALPHA),
        classificationType,
        outline: false,
      },
    });
    dataSource.entities.add({
      id: `dvf-cell:${cell.key}:edge`,
      name,
      description,
      polyline: {
        positions: [...positions, positions[0]],
        width: CELL_OUTLINE_WIDTH_PX,
        material: new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString(css).withAlpha(CELL_OUTLINE_ALPHA),
        ),
        clampToGround: true,
        classificationType,
      },
    });
    drawn += 1;
  }
  return drawn;
}

const baseLayer = createAddressScanLayer({
  id: DVF_LAYER_ID,
  name: 'Prix de l’immobilier (DVF)',
  icon: '€',
  source: 'DVF — Etalab / DGFiP',
  endpoint: '/api/dvf',
  updateInterval: UPDATE_INTERVAL_MS,
  runtimeParams: {
    type: {
      values: DVF_TYPE_FILTERS.map((entry) => entry.id),
      defaultValue: 'tous',
    },
  },
  // DELIBERATELY ABSENT FROM `params`. The proxy is asked for every mutation
  // in the radius whatever the chip says, and the filter is applied to the
  // rows it returned — see {@link DVF_TYPE_FILTERS}. Putting `type` in the
  // query string would move the signature, refetch an identical reply, and
  // spend a rate-limit slot to draw a subset of what was already in memory.
  drawOnlyParams: ['type'],
  // TWO QUESTIONS, ONE ROUTE. Below 600 m the disc, above it the box — and the
  // box is ABSENT from the query string rather than flagged, so the proxy reads
  // the regime off the parameters it was given. Same contract as
  // `urbanismeGpu.js`, and it means a share link carries the regime for free.
  params: (point) => {
    const cells = scanCellParams(point);
    return Object.keys(cells).length ? cells : { radius: String(SCAN_RADIUS_M) };
  },
  // BIGGER IN CELL MODE, because the box is already snapped to a tile: inside
  // one tile every camera position asks the identical question, and the shell
  // skips a scan only when BOTH the centre has not moved far enough AND the
  // query string is unchanged. Half a tile is what stops a pan across a block
  // from re-asking a question whose answer is already drawn.
  minShiftKm: () => (_cellMode ? 0.6 : ADDRESS_SCAN_MIN_SHIFT_KM),
  // ON, since the layer started washing the PLOTS. A ground-classification
  // primitive reads its classification surface once, when it is built, so a
  // draw addressed to terrain survives a switch to the photoreal tileset —
  // which hides the globe — by silently showing nothing. The markers never
  // needed this; the parcels do.
  redrawOnMapStack: true,
  // What the answer covers, so a caller choosing a camera height frames the
  // block this layer speaks for rather than the 12 km its ceiling allows.
  scanReachM: SCAN_RADIUS_M,

  /**
   * A cell's disc and its edge are one subject, so a click on either selects
   * the disc — the mark that has a colour to take and a size to grow. Same rule
   * the DPE layer applies to its footprint and its badge.
   */
  selectionFor(entityId) {
    const id = String(entityId ?? '');
    return id.startsWith('dvf-cell:') && id.endsWith(':edge')
      ? id.slice(0, -':edge'.length)
      : null;
  },

  render({ payload, dataSource, viewer, runtime, point }) {
    _typeFilter = String(runtime?.type ?? 'tous');
    // THE PAYLOAD DECIDES, NOT THE CAMERA. An answer in flight while the reader
    // crossed 600 m lands after the altitude already says the other thing, and
    // drawing a box payload as points — or the reverse — is one frame of
    // garbage plus a key describing neither. `cells` is only ever present on a
    // box answer.
    _cellMode = Array.isArray(payload?.cells);
    if (_cellMode) {
      const drawn = drawDvfCells(payload, dataSource, gpuClassificationTypeForScene(viewer?.scene));
      drawScanBoundary(dataSource, { id: 'dvf:scan-edge', box: payload.box });
      // The building theme paints volumes from individual sales and a cell has
      // none, so it is WITHDRAWN rather than left standing: volumes tinted from
      // the block the reader left is exactly the failure `withdrawIfDormant`
      // exists to prevent, arrived by a different road.
      _themePayload = null;
      publishTheme();
      return drawn;
    }
    const reference = dvfReference(payload);
    const sales = filterSalesByType(payload.sales, _typeFilter);
    // THE GROUND FIRST, so the markers are added after and pick above their
    // own wash. Counted separately from the markers: a plot is not a sale, and
    // the row's number has always been "how many mutations are on screen".
    drawDvfParcels(
      dataSource, payload.parcels, sales, reference,
      gpuClassificationTypeForScene(viewer?.scene),
    );
    let drawn = 0;
    for (const sale of sales) {
      if (!Number.isFinite(sale.lon) || !Number.isFinite(sale.lat)) continue;
      const price = saleRatioPrice(sale);
      const comparable = price !== null;
      const klass = saleRatioClass(price, reference.medianPrixM2);
      const ratio = comparable && reference.medianPrixM2
        ? price / reference.medianPrixM2
        : null;
      dataSource.entities.add({
        id: `dvf:${sale.id}`,
        position: Cesium.Cartesian3.fromDegrees(sale.lon, sale.lat),
        billboard: {
          // A EURO SIGN, not a disc. Turn this layer on with the DPE layer and
          // both used to draw coloured dots over the same roofs, with nothing
          // to say which register a dot came from — colour was already spent
          // on the price ratio here and on the A–G scale there, so the shape
          // is what carries the source. See `addressMarkerIcons.js`.
          image: addressMarkerGlyph('euro'),
          // Not reduced when the volumes are painted: the marker is the click
          // surface, it is all there is when Bâti 3D is off, and its size
          // already carries "has a comparable €/m²" (A3). See the header.
          width: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          height: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          // The glyph is white line-art; this tint IS the price channel, and
          // the same tint the building volume takes.
          color: saleColor(price, reference.medianPrixM2),
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'dvf-sale',
          prixM2: sale.prixM2,
          comparable,
          ratioClass: klass ? klass.id : null,
          referenceMedianPrixM2: reference.medianPrixM2,
          date: sale.date,
          nature: sale.nature,
          rowCount: sale.rowCount,
        },
        name: sale.address || sale.commune || 'Mutation',
        description: dvfSaleCard(sale, reference),
      });
      drawn += 1;
    }
    // The edge of the disc, so the field of markers reads as a probe rather
    // than as a layer that stopped drawing halfway. Never counted — see
    // `scanBoundary.js`.
    drawScanBoundary(dataSource, {
      id: 'dvf:scan-edge',
      centre: point,
      radiusM: SCAN_RADIUS_M,
    });
    // The theme speaks for the answer that was just drawn, so it is published
    // here rather than from `update()`: `render` is also what a map-stack
    // redraw calls, and the points must never outlive the payload.
    _themePayload = payload;
    publishTheme();
    return drawn;
  },

  /**
   * The key to the ramp, plus the two admissions A5 asks for: what was clipped
   * and what could not be placed.
   */
  rowControls(runtime, _summary, payload) {
    // READ, NEVER WRITTEN, here: `render` owns the mirror — see `_typeFilter`.
    // The chips still show the runtime, which is the truth even on the tick
    // before the draw has caught up with it.
    const filter = String(runtime?.type ?? 'tous');
    const chips = DVF_TYPE_FILTERS.map((entry) => ({
      id: `type:${entry.id}`,
      label: entry.label,
      active: entry.id === filter,
      params: { type: entry.id },
      // OFFERED TO EVERY MEMBER OF THE ROW. The estimate next door asks the
      // same question about the same doorway and takes the same vocabulary;
      // `tous` is not in ITS enum and is simply refused, which is the right
      // outcome — "show me everything on the map" is not an instruction to
      // change what is being valued.
      fanOut: true,
      title: entry.title,
    }));
    // Built from the payload that was actually DRAWN, so a layer that has never
    // scanned — or whose scan went dormant above the ceiling — publishes
    // nothing rather than a key to a wash that is not on screen. The shell
    // hands over a null payload in exactly those two cases. The CHIPS are
    // published either way: a control a reader cannot find until the layer has
    // answered is a control they will not find.
    if (!payload) return { chips };
    if (Array.isArray(payload.cells)) {
      // NO TYPE CHIPS IN CELL MODE, and they are removed rather than disabled.
      // `drawOnlyParams` filters rows the proxy served; a cell answer carries
      // no rows to filter, so a chip here would be a control that silently does
      // nothing — worse than one that is not offered.
      return {
        legend: dvfLegendEntries(dvfCellReference(payload), countCellsByClass(payload.cells)),
        legendBar: true,
        legendNote: dvfCellLegendNote(payload),
        note: dvfCellDisclosure(payload),
      };
    }
    const reference = dvfReference(payload);
    const sales = filterSalesByType(payload.sales, filter);
    return {
      chips,
      legend: dvfLegendEntries(reference, countByClass(sales, reference.medianPrixM2)),
      // ORDERED CLASSES, SO ONE BAR. The five steps of the ramp plus the
      // neutral are one distribution of one population — how the block's
      // sales fall around the commune's median IS the layer's argument, and
      // six stacked rows never showed its shape.
      legendBar: true,
      legendNote: dvfLegendNote(reference, { parcels: (payload.parcels || []).length }),
      note: dvfLegendDisclosure(reference, payload.summary || {}, sales.length, {
        filter,
        hidden: (payload.sales || []).length - sales.length,
        parcels: payload.parcels,
      }),
    };
  },

  summarize(payload) {
    const summary = payload.summary || {};
    if (Array.isArray(payload.cells)) {
      const reference = dvfCellReference(payload);
      return {
        // NAMED `cells`, so nothing downstream can mistake this for the disc
        // answer. `salesFound` still means "mutations behind the drawing", but
        // it is now the box's and not a radius's, and `scanBasis` is what says
        // which — the voice surface reads it before it quotes a number.
        scanBasis: 'cells',
        cellCount: summary.cells ?? 0,
        cellSizeM: summary.cellM ?? null,
        communes: (payload.communes || []).map((entry) => entry.name || entry.code),
        years: payload.years ?? null,
        salesFound: summary.count ?? 0,
        comparableCount: summary.pricedCount ?? 0,
        localMedianPrixM2: summary.medianPrixM2 ?? null,
        referenceBasis: reference.basis,
        referenceLabel: reference.label,
        // Every denominator, not one — see `dvfCellReference`.
        references: reference.references,
        themeId: DVF_LAYER_ID,
        themePrecedence: DVF_THEME_PRECEDENCE,
        themePoints: 0,
        coverage: dvfCellDisclosure(payload),
        legend: dvfLegendEntries(reference, countCellsByClass(payload.cells)),
      };
    }
    const reference = dvfReference(payload);
    return {
      commune: payload.commune?.name ?? null,
      communeCode: payload.commune?.code ?? null,
      years: payload.years ?? null,
      salesFound: summary.count ?? 0,
      salesServed: summary.served ?? null,
      truncated: summary.truncated === true,
      // The gap between these two is the honesty of the medians below them.
      comparableCount: summary.comparableCount ?? 0,
      // NAMED, both of them. The block statistic and the denominator are two
      // different numbers and neither is allowed to answer to `medianPrixM2`.
      localMedianPrixM2: summary.medianPrixM2 ?? null,
      referenceBasis: reference.basis,
      referenceLabel: reference.label,
      referenceTerritory: reference.territory,
      referenceMedianPrixM2: reference.medianPrixM2,
      referenceComparableCount: reference.comparableCount,
      referenceCount: reference.count,
      referenceUnplacedCount: reference.unplacedCount,
      p25PrixM2: summary.p25PrixM2 ?? null,
      p75PrixM2: summary.p75PrixM2 ?? null,
      perYear: summary.perYear ?? null,
      themeId: DVF_LAYER_ID,
      themePrecedence: DVF_THEME_PRECEDENCE,
      themePoints: (payload.sales || []).length,
      // The ground the register named and the cadastre returned. Reported
      // because "no plot is tinted" has two causes — nothing sold here, or
      // Etalab publishes no parcels for this commune — and a count is the
      // only thing that tells them apart from outside.
      parcelsDrawn: (payload.parcels || []).length,
      // D1 in the stats as well as in the panel: a caller reading this layer
      // programmatically gets the ramp and its denominator, not just a count.
      legend: dvfLegendEntries(reference, countByClass(payload.sales || [], reference.medianPrixM2)),
    };
  },
});

/**
 * Above `ADDRESS_SCAN_MAX_ALTITUDE_M` the shell clears the draw WITHOUT calling
 * `render`, so nothing in this module would otherwise learn that the answer on
 * screen has been retracted — and a theme built from a block in Paris would go
 * on telling the volumes of whatever city the reader lands in next that no sale
 * was ever recorded there.
 *
 * The reconciliation hangs off `getStats()` because that is the only method the
 * shell exposes that runs after an internal scan (the camera-settled path calls
 * `runScan` directly, never `update`). It is idempotent, it touches nothing
 * unless the layer has gone dormant with a theme still published, and in that
 * exact case `getStats()` is at its cheapest — the shell skips `summarize()`
 * when there is no payload.
 * @param {object} stats
 * @returns {object} the same stats
 */
function withdrawIfDormant(stats) {
  if (stats?.dormant && _themePayload) {
    _themePayload = null;
    publishTheme();
  }
  return stats;
}

/**
 * The layer, wrapped so that switching it off also hands the volumes back.
 *
 * `createAddressScanLayer` has no lifecycle hook for this, and it is a shared
 * file this module does not own — so the composition happens here, where the
 * theme is. Every method of the base layer closes over its own state rather
 * than `this`, so spreading it is safe.
 */
const dvfSalesLayer = {
  ...baseLayer,

  init(viewer) {
    _themePayload = null;
    _themeEnabled = false;
    clearBuildingTheme(DVF_LAYER_ID);
    baseLayer.init(viewer);
  },

  getStats() {
    return withdrawIfDormant(baseLayer.getStats());
  },

  enable(viewer) {
    _themeEnabled = true;
    baseLayer.enable(viewer);
    // Republish what is already in hand: a layer switched off and on again
    // repaints immediately instead of waiting for the next scan.
    publishTheme();
  },

  disable() {
    _themeEnabled = false;
    _themePayload = null;
    _cellMode = false;
    publishTheme();
    baseLayer.disable();
  },

  destroy(viewer) {
    _themeEnabled = false;
    _themePayload = null;
    publishTheme();
    baseLayer.destroy(viewer);
  },

  async update(viewer, options) {
    const result = await baseLayer.update(viewer, options);
    // The authoritative moment, and the one that still runs when the panel is
    // hidden and `getStats()` is not being polled.
    withdrawIfDormant(baseLayer.getStats());
    return result;
  },

  /**
   * The drawn mutations, for the analyst engine and for "what is near here".
   *
   * `_themePayload` is the read handle because it IS the payload that was last
   * rendered: the shell keeps its own copy private, and this one is set by
   * `render` and dropped the moment the layer goes off or dormant. So a query
   * can never be answered from a block the reader has already flown away from.
   *
   * @param {number} [maxCount=2000] Ceiling, shared with every other layer.
   * @returns {Array<object>}
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_themeEnabled || !_themePayload) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const out = [];
    for (const sale of _themePayload.sales || []) {
      if (out.length >= limit) break;
      const record = dvfSaleRecord(sale);
      if (record) out.push(record);
    }
    return out;
  },

  /** The mutation the operator clicked, ready to be spoken. */
  getSelectedInfo() {
    const selectedId = baseLayer.getStats()?.selectedId || null;
    if (!selectedId || !_themePayload) return null;
    const sale = (_themePayload.sales || []).find((entry) => `dvf:${entry.id}` === selectedId);
    return sale ? dvfSaleRecord(sale) : null;
  },

  /** The block's own figures, so voice and panel cannot disagree. */
  getVoiceSummary() {
    return _themeEnabled ? dvfVoiceSummary(dvfSalesLayer.getStats()) : null;
  },
};

/** Test seam: the dormancy reconciliation, without a camera. */
export function _dvfWithdrawIfDormantForTest(stats) {
  return withdrawIfDormant(stats);
}

/** Test seam: drive the theme without a viewer. */
export function _dvfSetThemePayloadForTest(payload, enabled = true) {
  _themeEnabled = enabled;
  _themePayload = payload;
  return publishTheme();
}

export default dvfSalesLayer;
