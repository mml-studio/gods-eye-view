import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import {
  AVIS_DEFAULT_SURFACE,
  AVIS_DEFAULT_TYPE,
  AVIS_MAX_CI_DEVIATION,
  AVIS_MIN_COMPARABLES,
  AVIS_RUNGS,
  AVIS_SUBJECT_SURFACES,
  AVIS_TYPES,
} from './avisValeurFeed.js';

/**
 * Avis de valeur — the estimate, drawn beside the sales it was built from.
 *
 * `avisValeurFeed.js` holds the arithmetic and the reasons; this file holds the
 * two decisions that only exist once the answer is on a globe.
 *
 * ── DECISION ONE: THE ESTIMATE MUST NOT LOOK LIKE A SALE (A1) ───────────────
 *
 * Everything this layer draws comes from one register, and one of the things it
 * draws did not happen. The comparables are real mutations and keep the
 * register's own silhouette — the **€** of `addressMarkerIcons.js`, the same
 * shape `dvfSales.js` draws, because shape says WHICH REGISTER a dot comes from
 * and lying about that to decorate a layer would be worse than the confusion it
 * avoids. The subject takes the pack's **target**, documented there as the mark
 * for "the ORIGIN of a measurement rather than a thing found at an address",
 * which is exactly what an estimated address is. So the one marker on screen
 * that is not a transaction is the one marker that is not a euro sign.
 *
 * The colours carry the second half of the separation. `dvfSales.js` spends its
 * ramp on each sale's ratio to the COMMUNE median; this layer spends its three
 * classes on each comparable's position in the band THIS answer published.
 * Measured with `buildingTheme.deltaE76`, the three classes sit at ΔE76 **31.6
 * or more from every colour of the DVF ramp** and 56.6 to 72.3 apart from each
 * other, so a reader with both layers on can see that two different questions
 * are being answered over the same roofs.
 *
 * ── DECISION TWO: THE CIRCLE IS PART OF THE ANSWER ──────────────────────────
 *
 * The rung the ladder stopped at is drawn as a ring at its own radius. A number
 * that came from 300 m and the same number that came from the whole commune are
 * different claims, and the difference is invisible in a legend line nobody
 * reads. When the answer came from the commune rung there is no ring — the
 * reach is the boundary, not a circle — and the legend says so in words rather
 * than drawing a circle that would be a lie about the shape of the territory.
 *
 * ── WHY IT PINS ON CLICK ────────────────────────────────────────────────────
 *
 * A camera-following estimate answers about whatever the map drifted over,
 * which is fine for reading a street and useless for "what is THIS door worth"
 * — the only question the layer is for. A click on bare ground pins the
 * subject, the same gesture and the same wrapper `isochroneRings.js` uses, and
 * the pin also lifts the altitude ceiling so a reader can pull back far enough
 * to see a commune-wide comparable set.
 *
 * @module data/avisValeur
 */

/** Layer id, matching the taxonomy and the share-token registry. */
export const AVIS_LAYER_ID = 'avis-valeur';

/** Editions are annual; this cadence is about camera movement, not freshness. */
const UPDATE_INTERVAL_MS = 600_000;

/** Marker sizes, in CSS px. */
const SUBJECT_PX = 30;
/**
 * CONSTANT, and smaller than either of `dvfSales.js`'s two sizes (19 / 15 px).
 * Size carries a datum there — "has a comparable €/m²" — and carries none here,
 * because every dot this layer draws is by construction a comparable. A
 * constant is not a channel, so A3 is untouched; what the smaller dot buys is
 * that the subject stays the loudest thing on screen.
 */
const COMPARABLE_PX = 14;

/**
 * The subject's tint. ΔE76 33.3 from the nearest colour of the DVF ramp and of
 * this layer's own three classes — measured, not chosen by eye — because it is
 * the one mark on the globe that stands for a number nobody paid.
 */
export const AVIS_SUBJECT_COLOR = '#00ffa3';

/** The subject when the layer refused to publish a centre. */
export const AVIS_SUBJECT_WITHHELD_COLOR = '#9aa7bd';

/**
 * Where a comparable sits in the band this answer published.
 *
 * Three classes and not five: the band has exactly two edges, so a reader can
 * only be asked "under, inside, over". Adding intermediate steps would be
 * inventing gradations the quartiles do not have.
 */
export const AVIS_BAND_CLASSES = Object.freeze([
  Object.freeze({
    id: 'under',
    color: '#63b3ff',
    label: 'sous la fourchette',
    blurb: 'Vente comparable dont le prix au m² est sous le premier quartile des '
      + 'comparables retenues.',
  }),
  Object.freeze({
    id: 'inside',
    color: '#f4ece0',
    label: 'dans la fourchette',
    blurb: 'La moitié des ventes comparables : c’est la fourchette publiée, et c’est '
      + 'elle qui décrit ce que vaut le bien, pas la médiane seule.',
  }),
  Object.freeze({
    id: 'over',
    color: '#e05aa6',
    label: 'au-dessus de la fourchette',
    blurb: 'Vente comparable dont le prix au m² dépasse le troisième quartile des '
      + 'comparables retenues.',
  }),
]);

/**
 * The class a comparable falls in, against the band the answer published.
 * @param {?number} prixM2
 * @param {?{p25: ?number, p75: ?number}} band
 * @returns {?object} One of {@link AVIS_BAND_CLASSES}, or null with no band.
 */
export function avisBandClass(prixM2, band) {
  if (!Number.isFinite(prixM2)) return null;
  if (!Number.isFinite(band?.p25) || !Number.isFinite(band?.p75)) return null;
  if (prixM2 < band.p25) return AVIS_BAND_CLASSES[0];
  if (prixM2 > band.p75) return AVIS_BAND_CLASSES[2];
  return AVIS_BAND_CLASSES[1];
}

/* ── formatting ───────────────────────────────────────────────────────────── */

const euros = (value) => (Number.isFinite(value) ? `${value.toLocaleString('fr-FR')} €` : '—');
const eurosPerM2 = (value) => (Number.isFinite(value)
  ? `${Math.round(value).toLocaleString('fr-FR')} €/m²` : '—');
// U+2212 for the sign, not the hyphen `toLocaleString` emits: the interval line
// two rows up prints a real minus, and two different dashes for one meaning on
// one card is the kind of detail a reader registers without being able to name.
const pct = (value) => (Number.isFinite(value)
  ? `${value > 0 ? '+' : ''}${Math.abs(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
    .replace(/^/, value < 0 ? '−' : '')} %` : '—');

/**
 * `±3,2 %` when the interval is symmetric, `−40 % / +12 %` when it is not.
 *
 * ONE `±` OVER AN ASYMMETRIC INTERVAL UNDERSTATES ONE SIDE, and an interval
 * built from order statistics is asymmetric whenever the sample is. The card
 * used to print half the width as a `±`, which read « ±20 % » over a lower
 * bound sitting 40 % below the median.
 * @param {?{low: number, high: number}} deviation
 * @returns {string}
 */
function deviationText(deviation) {
  if (!deviation) return '—';
  const one = (value) => value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  if (Math.abs(deviation.low - deviation.high) < 0.05) return `±${one(deviation.high)} %`;
  return `−${one(deviation.low)} % / +${one(deviation.high)} %`;
}

/** `éditions 2024 et 2025`, `édition 2025`. */
export function avisYearsLabel(years) {
  const list = [...new Set((Array.isArray(years) ? years : [])
    .map((year) => Number.parseInt(year, 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!list.length) return null;
  if (list.length === 1) return `édition ${list[0]}`;
  if (list.length === 2) return `éditions ${list[0]} et ${list[1]}`;
  return `éditions ${list[0]} à ${list[list.length - 1]}`;
}

/** `Appartement de 60 m²`. */
function subjectLabel(subject) {
  return `${subject?.type ?? AVIS_DEFAULT_TYPE} de ${subject?.surfaceM2 ?? AVIS_DEFAULT_SURFACE} m²`;
}

/**
 * The sentence a withheld centre travels with. Never "estimation indisponible"
 * on its own: the reader is owed which of the four silences this is.
 * @param {?object} payload
 * @returns {?string}
 */
export function avisRefusalText(payload) {
  const estimate = payload?.estimate;
  if (!estimate || estimate.basis === 'comparables') return null;
  const count = estimate.count || 0;
  switch (estimate.reason) {
    case 'register-does-not-cover':
      return 'Le registre DVF ne couvre pas ce département : Bas-Rhin, Haut-Rhin, Moselle et '
        + 'Mayotte relèvent du livre foncier, pas du fichier immobilier. Ce n’est pas '
        + '« aucune vente ici », c’est « ce fichier n’existe pas ici ».';
    case 'no-comparable':
      return `Aucune vente comparable dans ces éditions, jusqu’à la commune entière : moins de `
        + `${AVIS_MIN_COMPARABLES} ventes d’un ${subjectLabel(payload.subject).toLowerCase()}. `
        + 'Rien n’est publié plutôt qu’un chiffre emprunté ailleurs.';
    case 'centre-softer-than-market':
      return `Fourchette seulement : sur ${count} ventes comparables, l’intervalle sur la médiane `
        + 'n’est pas plus étroit que l’écart interquartile — on ne connaît pas le milieu mieux '
        + 'que le marché n’est dispersé, donc le milieu n’ajoute rien à la fourchette. Cas '
        + 'limite compris : un échantillon sans dispersion du tout, où l’intervalle serait de '
        + 'largeur nulle et se lirait comme une certitude.';
    case 'interval-too-wide':
      return `Fourchette seulement : sur ${count} ventes comparables, une des deux bornes de `
        + `l’intervalle sur la médiane s’écarte de plus de `
        + `${Math.round(AVIS_MAX_CI_DEVIATION * 100)} % du milieu. Un nombre qui peut être faux `
        + 'd’un cinquième n’est pas un nombre.';
    default:
      return 'Estimation retenue, sans raison publiée — cet état ne devrait pas exister.';
  }
}

/**
 * The card of the subject: the whole answer, in the order a reader needs it.
 * @param {?object} payload
 * @returns {{title: string, details: string[]}}
 */
export function avisSubjectCard(payload) {
  const estimate = payload?.estimate;
  const subject = payload?.subject;
  const title = `${subjectLabel(subject)} — estimation`;
  const details = [];
  const prix = estimate?.prixM2;
  if (estimate?.basis === 'comparables') {
    details.push(euros(estimate.valeur?.median));
    details.push(`${eurosPerM2(prix.median)} — médiane de ${estimate.count} ventes comparables`);
  } else {
    details.push('pas de valeur publiée');
  }
  if (prix && Number.isFinite(prix.p25) && Number.isFinite(prix.p75)) {
    // TWO LINES, and the split is the honesty. The €/m² band is a fact about
    // the comparables; the € band is that band multiplied by the subject's own
    // surface, and NOT a range the comparables sold for. Printed as one line it
    // read « fourchette 417 000 à 545 000 € — la moitié des ventes
    // comparables », which is false whenever the comparables are not all the
    // subject's size: forty sales of 48 m² and 72 m² all at 1 000 €/m² give a
    // 60 000 € band that not one of the forty landed in.
    details.push(`fourchette ${eurosPerM2(prix.p25)} à ${eurosPerM2(prix.p75)} — la moitié des `
      + 'ventes comparables');
    details.push(`soit ${euros(estimate.valeur?.p25)} à ${euros(estimate.valeur?.p75)} ramené aux `
      + `${payload.subject?.surfaceM2} m² du sujet — pas des prix payés`);
  }
  if (prix?.ci90 && prix.ciDeviationPct) {
    details.push(`milieu connu à ${deviationText(prix.ciDeviationPct)} `
      + `(${eurosPerM2(prix.ci90.lo)} à ${eurosPerM2(prix.ci90.hi)}, `
      + `intervalle à ${Math.round(prix.ci90.coverage * 100)} % sous l’hypothèse que ces ventes `
      + 'se comportent comme un tirage indépendant du marché local)');
  }
  const refusal = avisRefusalText(payload);
  if (refusal) details.push(refusal);
  if (estimate?.rung) {
    details.push(`mesuré sur ${estimate.rung.label}`
      + (avisYearsLabel(payload.years) ? `, ${avisYearsLabel(payload.years)}` : ''));
  }
  if (Number.isFinite(estimate?.surfaceMedian)) {
    details.push(`surface médiane des comparables ${estimate.surfaceMedian} m²`);
  }
  if (Number.isFinite(estimate?.terrainMedian)) {
    details.push(`terrain médian ${estimate.terrainMedian.toLocaleString('fr-FR')} m² — le prix `
      + 'd’une maison porte son terrain et rien ici ne le neutralise');
  }
  const drift = payload?.drift;
  if (drift?.basis === 'commune-year' && Number.isFinite(drift.pct)) {
    details.push(`médian communal ${pct(drift.pct)} de ${drift.fromYear} à ${drift.toYear} — `
      + 'mesuré, jamais appliqué : aucune vente n’est ramenée à l’argent d’une autre année');
  }
  if (estimate?.symbolicCount > 0) {
    details.push(`dont ${estimate.symbolicCount} vente(s) déclarée(s) sous 10 000 € — gardées et `
      + 'signalées, pas filtrées');
  }
  if (payload?.unavailableYears?.length) {
    details.push(`millésime(s) ${payload.unavailableYears.join(', ')} indisponible(s) au moment `
      + 'du calcul — l’échantillon est plus mince que la fenêtre annoncée');
  }
  details.push('estimation GEV à partir des comparables DVF — pas un avis de valeur réglementaire');
  return { title, details };
}

/* ── chips ────────────────────────────────────────────────────────────────── */

/**
 * The subject the layer is asking about, offered as chips.
 *
 * A surface chip is not a multiplier: it CHOOSES THE COMPARABLE BAND, so the
 * title says what changing it changes. The chips build from the runtime alone
 * and so exist before the first scan; the counts arrive with the summary.
 *
 * ── THE TYPE CHIPS ARE NOT HERE ANY MORE, AND THAT IS THE POINT ────────────
 *
 * `Appart.` and `Maison` used to be this layer's first two chips, and on the
 * fused row they sat beside the map's own dots looking exactly like a filter
 * over them. They were not: they chose the subject of an ESTIMATE and left
 * every mutation on screen untouched. The reported symptom, Bayonne
 * 2026-09-14, with `Maison` lit over a centre that holds no house at all:
 * « beaucoup de ventes de maisons apparaissent […] soit le tri ne fonctionne
 * pas, soit y a quelque chose que je ne comprends pas ».
 *
 * The type now lives on the row's PRIMARY (`DVF_TYPE_FILTERS` in
 * `dvfSales.js`), where it filters the map, and the manager offers it to this
 * layer through the fan-out — same vocabulary, same click, so the dots and
 * the headline above them can no longer describe different populations. The
 * runtime param is untouched: a share link, the voice surface and
 * `setParams` all still steer the subject exactly as before. What went away
 * is a second control for one decision.
 *
 * The SURFACE chips stay, because they are this layer's alone: nothing on the
 * map is filtered by the size of a hypothetical flat.
 *
 * @param {Record<string, string>} runtime
 * @param {?object} summary
 * @returns {Array<object>}
 */
export function avisChips(runtime, summary = null) {
  const surface = String(runtime?.surface ?? AVIS_DEFAULT_SURFACE);
  const chips = [];
  for (const value of AVIS_SUBJECT_SURFACES) {
    const active = String(value) === surface;
    let title = `Sujet de ${value} m² — choisit la bande de surface des comparables, `
      + 'pas seulement le multiplicateur';
    if (active && Number.isFinite(summary?.comparableCount)) {
      title += ` — ${summary.comparableCount} comparables retenues`;
    }
    chips.push({
      id: `surface:${value}`,
      label: `${value} m²`,
      active,
      params: { surface: String(value) },
      title,
    });
  }
  if (summary?.pinned) {
    chips.push({
      id: 'centre:camera',
      label: 'Suivre la caméra',
      active: false,
      params: { centre: 'camera' },
      title: 'Relâcher le point choisi et estimer à nouveau sous la caméra — le point choisi '
        + 'n’est PAS transporté par un lien de partage, qui rouvre sous la caméra',
    });
  }
  return chips;
}

/* ── legend ───────────────────────────────────────────────────────────────── */

/**
 * The key to the layer, headed by the answer itself.
 *
 * The first row is the estimate rather than a colour, for the same reason
 * `dvfSales.js` heads its legend with the denominator: the number is what the
 * layer is for, and a number without the sentence that qualifies it is a
 * decoration. Every row that follows is either a class of the ramp with its
 * count, or an admission A5 requires.
 *
 * @param {?object} payload
 * @param {{pinned?: boolean}} [options] Whether the subject is a chosen point;
 *   the layer knows, the payload does not.
 * @returns {Array<object>}
 */
export function avisLegendEntries(payload, { pinned = false } = {}) {
  if (!payload) return [];
  const estimate = payload.estimate || {};
  const prix = estimate.prixM2;
  const entries = [];

  // ONE CHANNEL FOR THE ANSWER, and it is what makes the block fit.
  //
  // `_refreshMapLegend` prints a STACKED entry's `blurb` as body text and an
  // entry that shares a channel's as a tooltip. These four rows carry the
  // honest caveats — a dispersion is not an error bar, a euro total is not a
  // price anyone paid, an interval on the median says nothing about where one
  // flat sits — and as body text they measured **828 px in a 216 px rail**
  // with the price ramp above them: three and a half screens of prose for a
  // key whose whole job is to be readable without being opened.
  //
  // Nothing is dropped. The pointer still reaches every sentence, `avisCard`
  // prints all of them in full for the reader who clicks the estimate, and
  // the LABELS keep the arithmetic that must never be mis-stated — which is
  // why the band's is in €/m² and not in euros.
  const ANSWER = 'Ce qu’il vaut';
  if (estimate.basis === 'comparables') {
    entries.push({
      label: `${subjectLabel(payload.subject)} — ${euros(estimate.valeur?.median)}`,
      color: null,
      channel: ANSWER,
      count: estimate.count,
      blurb: `Médiane de ${estimate.count} ventes comparables à ${eurosPerM2(prix.median)}, `
        + `retenues sur ${estimate.rung?.label}`
        + `${avisYearsLabel(payload.years) ? `, ${avisYearsLabel(payload.years)}` : ''}. `
        + 'Le compte est le nombre de ventes derrière le chiffre, pas le nombre de logements '
        + 'du quartier.',
    });
  } else {
    entries.push({
      label: `${subjectLabel(payload.subject)} — pas de valeur publiée`,
      color: null,
      // NOT in the channel: a refusal is the one line of this block a reader
      // must be able to read without a pointer, because it is the answer.
      count: estimate.count || 0,
      blurb: avisRefusalText(payload) || '',
    });
  }

  if (prix && Number.isFinite(prix.p25) && Number.isFinite(prix.p75)) {
    // TWO ROWS BECAME ONE, AND THE LABEL KEPT THE €/m². The band in €/m² and
    // the same band multiplied by the subject's surface were two full entries
    // with a paragraph each; they are one fact in two units. Which unit goes
    // in the LABEL is not a layout choice, it is A1: the claim « half the
    // comparable sales landed in this band » is only ever true of the price
    // per square metre, because the comparables do not all have the subject's
    // surface. So the €/m² carries the claim, and the euro total — the number
    // the reader actually came for — sits in the sentence under it, with the
    // caveat that belongs to it and cannot be separated from it.
    entries.push({
      label: `fourchette ${eurosPerM2(prix.p25)} à ${eurosPerM2(prix.p75)}`,
      color: null,
      channel: ANSWER,
      blurb: 'La moitié des ventes comparables ont changé de main dans cette bande de prix au '
        + `m². Aux mêmes prix, ${subjectLabel(payload.subject).toLowerCase()} vaudrait `
        + `${euros(estimate.valeur?.p25)} à ${euros(estimate.valeur?.p75)} — ce ne sont PAS les `
        + 'prix des ventes comparables, qui n’ont pas toutes cette surface. Et ce n’est pas une '
        + 'barre d’erreur qui rétrécit quand les données s’accumulent : c’est la dispersion du '
        + 'marché. Où se situe CE bien-là dedans — étage, état, vue, exposition — le registre '
        + 'ne le dit pas, et la fourchette ne le borne pas non plus.',
    });
  }
  if (prix?.ci90 && prix.ciDeviationPct) {
    entries.push({
      label: `milieu connu à ${deviationText(prix.ciDeviationPct)}`,
      color: null,
      channel: ANSWER,
      blurb: `Intervalle sur la médiane, ${eurosPerM2(prix.ci90.lo)} à `
        + `${eurosPerM2(prix.ci90.hi)}, couverture ${Math.round(prix.ci90.coverage * 100)} %. `
        + 'Il dit à quel point le MILIEU de la fourchette est fermement placé, pas où le bien '
        + 'se situe dedans : deux incertitudes différentes, qui ne se mélangent pas. Exact pour '
        + 'un tirage INDÉPENDANT du marché local ; et l’échelon retenu ayant été choisi sur ces '
        + 'mêmes prix, cela ne peut que baisser la couverture réelle — mesuré à 91,9–92,8 % sur '
        + 'quatre communes réelles.',
    });
  }

  // THE MARKET'S OWN DIRECTION, KEPT VISIBLE. It is one of the four things a
  // reader opens this layer to find out, and it is measured over the same
  // editions as everything above it. Measured, never applied: the detail of
  // why is on the card, not in the key.
  const drift = payload.drift;
  if (drift?.basis === 'commune-year' && Number.isFinite(drift.pct)) {
    entries.push({
      label: `médian communal ${pct(drift.pct)} (${drift.fromYear} → ${drift.toYear})`,
      color: null,
      channel: ANSWER,
      blurb: 'Mesuré et affiché, jamais appliqué : aucune vente n’est ramenée à l’argent d’une '
        + 'autre année.'
        + (drift.loud ? ' Au-delà de 10 %, une comparable de deux ans se lit avec ça en tête.' : ''),
    });
  }

  const counts = new Map();
  for (const sale of payload.comparables || []) {
    const klass = avisBandClass(sale.prixM2, prix);
    if (klass) counts.set(klass.id, (counts.get(klass.id) || 0) + 1);
  }
  for (const klass of AVIS_BAND_CLASSES) {
    entries.push({
      label: klass.label,
      color: klass.color,
      count: counts.get(klass.id) || 0,
      blurb: klass.blurb,
      // ONE CHANNEL, SO THEY SIT SIDE BY SIDE. These three are the only
      // painted classes this layer has, and stacking them under three
      // paragraphs put the layer's own colours below the fold of the rail.
      // The caption is what says which population they divide — without it,
      // three swatches under a €444 000 headline read as classes of the
      // ESTIMATE rather than of the sales it was built from.
      channel: 'Les ventes qui le disent',
    });
  }

  return entries;
}

/**
 * The block's own provenance line, above the classes it frames.
 *
 * WHAT WAS MEASURED, WHERE, AND OVER WHAT. Those three moved out of the
 * headline entry's paragraph, where they were competing with the number the
 * reader came for. Up here they frame every row under them at once, which is
 * what this slot is for — and they are the difference between a figure from
 * the block next door and the same figure from the whole commune.
 *
 * @param {?object} payload
 * @returns {string}
 */
export function avisLegendMethod(payload) {
  const estimate = payload?.estimate || {};
  return [
    'Estimation GEV sur comparables DVF',
    estimate.rung?.label || null,
    avisYearsLabel(payload?.years),
  ].filter(Boolean).join(' · ');
}

/**
 * The A5 line: what the estimate refused, dropped or could not carry.
 *
 * NINE STACKED ENTRIES BECAME ONE SENTENCE. Every exclusion the projection
 * counts used to be a legend row with a paragraph — the VEFA premium, the
 * €1 sales, the comparables with no coordinate, the other dwelling type, the
 * unpriceable mutations, a clipped draw, a missing edition, a chosen point
 * that no share link carries. All true, all still counted, and together they
 * were three times the height of the answer they qualify.
 *
 * They belong on one line for the same reason `dvfLegendDisclosure` does:
 * A5 asks that clipping be DECLARED, and a declaration a reader scrolls past
 * to reach the colours is not read. What each one MEANS stays where a reader
 * asks for it — on the card, which is `avisCard`'s job.
 *
 * @param {?object} payload
 * @param {{pinned?: boolean}} [options]
 * @returns {string}
 */
export function avisLegendDisclosure(payload, { pinned = false } = {}) {
  if (!payload) return '';
  const estimate = payload.estimate || {};
  const excluded = payload.excluded || {};
  const parts = [];

  const dropped = [
    ['vefa', 'en VEFA'],
    ['zeroPrice', 'à un euro'],
    ['unplaced', 'sans coordonnée'],
    ['otherType', 'de l’autre type de logement'],
    ['notPriceable', 'sans €/m² exploitable'],
  ].filter(([key]) => excluded[key] > 0);
  if (dropped.length) {
    parts.push(`Écartées : ${dropped.map(([key, label]) => `${excluded[key]} ${label}`).join(', ')}`);
  }
  if (payload.truncated) {
    parts.push(`${payload.served} comparables dessinées sur ${estimate.count} retenues — `
      + 'les statistiques portent sur toutes');
  }
  if (payload.unavailableYears?.length) {
    parts.push(`millésime(s) ${payload.unavailableYears.join(', ')} non téléchargé(s) — ces `
      + 'éditions EXISTENT et ne sont pas arrivées : l’échantillon est plus mince que la '
      + 'fenêtre annoncée');
  }
  // A4: this silence has a cause, and the cause is the sample, not the market.
  // It reports the COUNTS rather than asserting something about them — there
  // are two ways to fail the threshold and the row used to claim the first one
  // in both cases.
  const drift = payload.drift;
  if (drift && drift.basis !== 'commune-year') {
    const solid = (drift.perYear || []).filter((year) => year.medianPrixM2 !== null).length;
    parts.push(`dérive du marché non mesurable ici — il faut deux millésimes d’au moins `
      + `30 ventes comparables, cette commune en a ${solid} `
      + `(${(drift.perYear || []).map((year) => `${year.year} ${year.comparableCount} vente(s)`)
        .join(', ') || 'aucun millésime'})`);
  }
  if (pinned) {
    parts.push('le point choisi ne voyage PAS dans le lien de partage, qui rouvre sous la caméra');
  }
  return parts.length ? `${parts.join(' · ')}.` : '';
}

/* ── the layer ────────────────────────────────────────────────────────────── */

/** Rounded like the isochrone pin, so a click and its answer share a key. */
function resolveCentre(value) {
  if (value === 'camera' || value === null) return 'camera';
  const [lon, lat] = String(value).split(',').map((part) => Number.parseFloat(part));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5 };
}

/** Positions of a circle of `radiusM` around a point, as a closed polyline. */
function circlePositions(lon, lat, radiusM, steps = 96) {
  const positions = [];
  const metresPerDegLat = 111_320;
  const metresPerDegLon = metresPerDegLat * Math.cos(Cesium.Math.toRadians(lat));
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    positions.push(Cesium.Cartesian3.fromDegrees(
      lon + (radiusM * Math.cos(angle)) / (metresPerDegLon || 1),
      lat + (radiusM * Math.sin(angle)) / metresPerDegLat,
    ));
  }
  return positions;
}

/** The answer the layer is currently speaking for, for `cardAnchor`/`afterDraw`. */
let _openedFor = null;
/**
 * The payload the layer last DREW, kept only so `getRowControls()` can rebuild
 * the legend with the pin state the shell owns. Cleared with the draw.
 */
let _lastPayload = null;

const base = createAddressScanLayer({
  id: AVIS_LAYER_ID,
  name: 'Avis de valeur (DVF)',
  icon: '≈',
  source: 'Estimation GEV — comparables DVF (Etalab / DGFiP)',
  endpoint: '/api/avis-valeur',
  updateInterval: UPDATE_INTERVAL_MS,
  // The block rung, which is where the estimate starts and where it lands
  // whenever the register is dense enough to answer. The ladder can widen to
  // the commune, but framing a camera on the widest rung a thin sample might
  // need would put the reader above the street the estimate is about.
  scanReachM: AVIS_RUNGS[0].radiusM,
  runtimeParams: {
    type: { values: [...AVIS_TYPES], defaultValue: AVIS_DEFAULT_TYPE },
    surface: {
      values: AVIS_SUBJECT_SURFACES.map((value) => String(value)),
      defaultValue: String(AVIS_DEFAULT_SURFACE),
    },
  },
  params: (_point, _viewer, runtime) => ({
    type: runtime.type ?? AVIS_DEFAULT_TYPE,
    surface: runtime.surface ?? String(AVIS_DEFAULT_SURFACE),
  }),

  rowControls: (runtime, summary, payload) => {
    // The shell's own view. The wrapper below re-renders both halves with the
    // pin state, which only it can see.
    _lastPayload = payload || null;
    return {
      chips: avisChips(runtime, summary),
      legend: payload ? avisLegendEntries(payload) : [],
      legendNote: payload ? avisLegendMethod(payload) : undefined,
      note: payload ? avisLegendDisclosure(payload) : undefined,
    };
  },

  render({ payload, dataSource, point }) {
    const estimate = payload.estimate || {};
    const prix = estimate.prixM2;
    let drawn = 0;

    // The reach that produced the number, when it is a circle. The commune rung
    // deliberately draws nothing: a commune is not a disc, and a ring at some
    // arbitrary radius would claim a shape the answer never had.
    if (Number.isFinite(estimate.rung?.radiusM)) {
      dataSource.entities.add({
        id: 'avis:rung',
        polyline: {
          positions: circlePositions(point.lon, point.lat, estimate.rung.radiusM),
          width: 2,
          material: Cesium.Color.fromCssColorString(AVIS_SUBJECT_COLOR).withAlpha(0.55),
          clampToGround: true,
        },
      });
    }

    for (const sale of payload.comparables || []) {
      if (!Number.isFinite(sale.lon) || !Number.isFinite(sale.lat)) continue;
      const klass = avisBandClass(sale.prixM2, prix);
      dataSource.entities.add({
        id: `avis:sale:${sale.id}`,
        position: Cesium.Cartesian3.fromDegrees(sale.lon, sale.lat),
        billboard: {
          // The register's own silhouette. These are real mutations and they
          // must keep saying so — see the header.
          image: addressMarkerGlyph('euro'),
          width: COMPARABLE_PX,
          height: COMPARABLE_PX,
          color: Cesium.Color.fromCssColorString(klass ? klass.color : '#9aa7bd'),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'avis-comparable',
          prixM2: sale.prixM2,
          bandClass: klass ? klass.id : null,
        },
        name: sale.address || 'Vente comparable',
        description: [
          sale.date,
          eurosPerM2(sale.prixM2),
          euros(sale.valeur),
          `${sale.surface} m²`,
          Number.isFinite(sale.rooms) && sale.rooms > 0 ? `${sale.rooms} pièces` : null,
          `${sale.distanceM} m du point estimé`,
          klass ? klass.label : null,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }

    // Last, so it is added over the comparables it was computed from.
    const card = avisSubjectCard(payload);
    dataSource.entities.add({
      id: 'avis:subject',
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      billboard: {
        image: addressMarkerGlyph('target'),
        width: SUBJECT_PX,
        height: SUBJECT_PX,
        color: Cesium.Color.fromCssColorString(estimate.basis === 'comparables'
          ? AVIS_SUBJECT_COLOR
          : AVIS_SUBJECT_WITHHELD_COLOR),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { kind: 'avis-subject', basis: estimate.basis },
      name: card.title,
      description: card.details.join(' · '),
    });
    drawn += 1;
    return drawn;
  },

  /**
   * A click on bare ground pins the subject. Consumed whether or not the pin
   * moved, so clicking the same spot twice never falls through to dismissal.
   */
  groundClick: ({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    avisValeurLayer.setParams({ centre: `${lon},${lat}` });
    return true;
  },

  /** Put the answer up once it is drawn and indexed — but only for a pin. */
  afterDraw({ payload, point, selectCard }) {
    if (!point?.pinned) {
      _openedFor = null;
      return;
    }
    const signature = `${point.lon},${point.lat}|${payload?.subject?.type}`
      + `|${payload?.subject?.surfaceM2}`;
    if (signature === _openedFor) return;
    _openedFor = signature;
    selectCard('avis:subject');
  },

  summarize(payload) {
    const estimate = payload.estimate || {};
    return {
      commune: payload.commune?.name ?? null,
      communeCode: payload.commune?.code ?? null,
      years: payload.years ?? null,
      coverageBasis: payload.coverage?.basis ?? null,
      subjectType: payload.subject?.type ?? null,
      subjectSurfaceM2: payload.subject?.surfaceM2 ?? null,
      basis: estimate.basis ?? null,
      reason: estimate.reason ?? null,
      comparableCount: estimate.count ?? 0,
      rungId: estimate.rung?.id ?? null,
      rungRadiusM: estimate.rung?.radiusM ?? null,
      rungBand: estimate.rung?.band ?? null,
      rungsTried: (estimate.tried || []).length,
      prixM2Median: estimate.prixM2?.median ?? null,
      prixM2Withheld: estimate.prixM2?.withheldMedian ?? null,
      prixM2P25: estimate.prixM2?.p25 ?? null,
      prixM2P75: estimate.prixM2?.p75 ?? null,
      ciDeviationLowPct: estimate.prixM2?.ciDeviationPct?.low ?? null,
      ciDeviationHighPct: estimate.prixM2?.ciDeviationPct?.high ?? null,
      ciDeviationMaxPct: estimate.prixM2?.ciDeviationPct?.max ?? null,
      ciCoverage: estimate.prixM2?.ci90?.coverage ?? null,
      valeurMedian: estimate.valeur?.median ?? null,
      valeurP25: estimate.valeur?.p25 ?? null,
      valeurP75: estimate.valeur?.p75 ?? null,
      surfaceMedian: estimate.surfaceMedian ?? null,
      terrainMedian: estimate.terrainMedian ?? null,
      symbolicCount: estimate.symbolicCount ?? 0,
      driftBasis: payload.drift?.basis ?? null,
      driftPct: payload.drift?.pct ?? null,
      excluded: payload.excluded ?? null,
      served: payload.served ?? 0,
      unavailableYears: payload.unavailableYears ?? [],
      truncated: payload.truncated === true,
      legend: avisLegendEntries(payload),
    };
  },
});

/**
 * The estimate this layer is currently publishing, in words a voice can say.
 *
 * THIS IS THE ANSWER TO "what does a flat cost around here", and it already
 * existed — computed by the proxy, printed on the card, and invisible to the
 * voice surface, which is how an operator asking for the price around a
 * Bordeaux bike station was told the assistant had no access to that analysis.
 *
 * Every figure is lifted from `getStats()` rather than recomputed. That is the
 * whole discipline of this function: the layer's selection rule (which
 * comparables, at which radius, over which years) is what makes the median
 * defensible, and a second median averaged from the drawn points by whoever is
 * speaking would be a different, undefended number wearing the same name.
 *
 * `basis` travels because it changes what the sentence may claim:
 *   comparables — a centre and an interval, publishable as an estimate;
 *   range       — the sample was too thin or too scattered to centre, so only
 *                 the quartiles may be said, never a single price;
 *   none        — nothing to say; `reason` says why in the proxy's own words.
 *
 * Null when the layer has nothing to speak for — off, or dormant above its
 * altitude ceiling.
 *
 * @param {object|null} stats The layer's own `getStats()` output.
 * @returns {object|null} Named, speakable fields, or null.
 */
export function avisVoiceSummary(stats) {
  if (!stats || stats.dormant) return null;
  // Not yet scanned is not "nothing to estimate from" — see the same third
  // state in dvfSales.js, and the live session that confused the two.
  if (!stats.basis) {
    return {
      subject: 'estimation immobilière',
      pending: true,
      note: 'The estimate has not been computed for this point yet. Say it is '
        + 'coming and ask again in a moment — this is NOT "no comparables here".',
    };
  }
  return {
    subject: `estimation d’un bien de type ${stats.subjectType ?? '?'} de ${stats.subjectSurfaceM2 ?? '?'} m²`,
    // Where the estimate was centred. The scan does not clear on arrival, so a
    // caller with no way to check would read one neighbourhood's estimate over
    // another's roofs — see the same note in dvfSales.js.
    measuredAt: stats.scanCentre ? { ...stats.scanCentre } : null,
    commune: stats.commune ?? null,
    years: stats.years ?? null,
    basis: stats.basis,
    reason: stats.reason ?? null,
    comparableCount: stats.comparableCount ?? 0,
    radiusM: stats.rungRadiusM ?? null,
    // The centre, and only when `basis` is 'comparables' — `range` means the
    // proxy refused to publish one, and repeating the quartiles' midpoint here
    // would smuggle it back in.
    estimatedPrixM2: stats.basis === 'comparables' ? stats.prixM2Median ?? null : null,
    estimatedValeurEur: stats.basis === 'comparables' ? stats.valeurMedian ?? null : null,
    prixM2P25: stats.prixM2P25 ?? null,
    prixM2P75: stats.prixM2P75 ?? null,
    intervalDeviationPct: stats.ciDeviationMaxPct ?? null,
    // A band is symmetric in metres and a market is not: say what the
    // comparables actually measured when it is not the subject's own surface.
    comparableSurfaceMedianM2: stats.surfaceMedian ?? null,
    driftPct: stats.driftPct ?? null,
  };
}

/**
 * The layer, wrapping the shared factory with a pinned subject.
 *
 * Spread rather than subclassed, for the reason `isochroneRings.js` gives: every
 * method the factory returns closes over its own state and none of them read
 * `this`, so copying the references is exact.
 */
const avisValeurLayer = {
  ...base,

  /**
   * `_openedFor` is module state and the card it guards is NOT: `disable()`
   * clears the selection, so a signature that outlived it suppressed the
   * reopen and left a pinned subject drawn with no card. Reset on every
   * lifecycle edge rather than only on the pin.
   */
  init(viewer) {
    _openedFor = null;
    base.init(viewer);
  },

  enable(viewer) {
    _openedFor = null;
    base.enable(viewer);
  },

  disable() {
    _openedFor = null;
    base.disable();
  },

  destroy(viewer) {
    _openedFor = null;
    base.destroy(viewer);
  },

  /**
   * `type` and `surface` are the shell's own enumerated runtime params and are
   * delegated untouched — including the refusal, which is the point. `centre`
   * is this layer's addition, because a coordinate is not an enum and cannot
   * live in the shell's closed sets.
   *
   * @param {{type?: string, surface?: string, centre?: string}} [params]
   * @param {{origin?: string}} [options]
   * @returns {boolean} False when anything in the call was refused.
   */
  setParams(params = {}, options = {}) {
    const { centre, ...enumerated } = params;
    // THE COORDINATE IS VALIDATED BEFORE ANYTHING IS APPLIED. Rejecting after a
    // partial application is the failure this file inherits from nothing: a
    // call of `{type: 'Maison', centre: 'bad'}` returned false with `Maison`
    // already in force, so the layer answered a question the caller had been
    // told was refused. `undefined` means "not in this call"; `null` from the
    // resolver means "given and unusable".
    const resolved = centre === undefined ? undefined : resolveCentre(centre);
    if (resolved === null) return false;
    if (Object.keys(enumerated).length && !base.setParams(enumerated, options)) return false;
    if (resolved !== undefined) {
      if (resolved === 'camera') _openedFor = null;
      base.setScanPin(resolved === 'camera' ? null : resolved);
    }
    // TRUE means "accepted", not "moved" — the base contract, which answers
    // true for a no-op. A caller that needs to know whether anything changed
    // reads `getParams()`.
    return true;
  },

  /**
   * What the panel and a share link read.
   *
   * `centre` is deliberately NOT serialized by `layerState.js` — the option
   * codec takes enums and a coordinate is not one — so a shared link reopens
   * following the camera, on the view its sender was looking at. It is reported
   * here so the row can offer the release chip.
   */
  getParams() {
    const pin = base.getScanPin();
    return { ...base.getParams(), centre: pin ? `${pin.lon},${pin.lat}` : 'camera' };
  },

  getRowControls() {
    const controls = base.getRowControls();
    if (!controls) return controls;
    // The pin is the shell's state, not the payload's, so both the chips and
    // the legend are rebuilt here where it can be read.
    const pinned = Boolean(base.getScanPin());
    const summary = base.getStats() || {};
    return {
      ...controls,
      chips: avisChips(base.getParams(), { ...summary, pinned }),
      legend: controls.legend?.length
        ? avisLegendEntries(_lastPayload, { pinned })
        : controls.legend,
      // The pin is one of the things the disclosure has to say — a chosen
      // point is NOT carried by a share link — so it is rebuilt here too,
      // where the pin can be read.
      note: controls.legend?.length
        ? avisLegendDisclosure(_lastPayload, { pinned })
        : controls.note,
    };
  },

  /** The published estimate, so voice and card cannot disagree. */
  getVoiceSummary() {
    return avisVoiceSummary(base.getStats());
  },
};

export default avisValeurLayer;
