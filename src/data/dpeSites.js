// src/data/dpeSites.js — the DPE register, grouped by the thing a map can
// actually point at.
//
// ── The measurement this file exists for ───────────────────────────────────
//
// A default scan of Paris 13e (2.3760, 48.8300, 200 m) serves 200 diagnostics
// out of 917. Those 200 rows carry **14 distinct coordinates**, 13 distinct
// BAN addresses and **5 distinct RNB identifiers**. One coordinate carries
// **42** of them.
//
// So the layer drew 200 billboards on 14 pixels. Only the topmost of each pile
// was ever visible or clickable; the other 186 were an atlas entry, a draw
// call and a card lottery each. And the reported symptom was not "there are
// too many badges" — it was «on ne comprend pas où est le bien», which is
// exactly right: a stack of letters on a street geocode says a diagnostic
// exists somewhere near here, and nothing more.
//
// It also broke the SEATING, which is the other half of the same report. Marks
// are lifted onto the drawn surface by `renderedSurface.js` under a budget of
// 24 probes per pass over six passes — 144 marks. 200 badges never fit, so
// dozens stayed on the scan-centre fallback height, and a mark at the wrong
// height under a camera that is not exactly overhead is a mark that SLIDES
// when the camera turns. Measured before this change, 1400 × 900, nadir at
// 420 m: 25.2 m of worst height error, 25.5 px of worst screen offset, and up
// to **72.6 px of slide across a 250 m pan**.
//
// Grouping fixes both at once, and the second one for free.
//
// ── What a site IS ─────────────────────────────────────────────────────────
//
// A DPE describes ONE DWELLING. A map cannot draw a dwelling: the register
// publishes no coordinate for a flat, and the envelope and the heating plant a
// diagnostic grades are shared by the whole block anyway. What a map CAN draw
// is the building, and the register names it — `id_rnb`, on 34.5 % to 73.7 %
// of the rows depending on the commune (see `rnbPivot.js`).
//
// So a site is, in order of preference:
//
//   1. **A BUILDING** — every diagnostic carrying the same `id_rnb`. The
//      register's own claim, not a guess.
//   2. **AN ADDRESS** — every diagnostic sharing a BAN key, when none of them
//      names a building. The geocode is a point on a street and the card says
//      so.
//   3. **A COORDINATE** — the fallback for a row with neither, which is the
//      shape `projectDpe` can still emit for an edition missing both columns.
//
// ── The propagation, and its one refusal ───────────────────────────────────
//
// A BAN address whose rows DISAGREE about nothing — where the rows that name a
// building all name the SAME one — lends that identifier to its rows that name
// none. This is not an inference about geography; it is the statement that two
// diagnostics at `93 rue du Chevaleret` are in the building at 93 rue du
// Chevaleret. Measured on the box above: 111 rows carry an identifier, 135
// after propagation, 8 of the 13 addresses fully resolved.
//
// Where an address carries TWO identifiers it is refused whole. Those are the
// real cases the rule must not paper over — a courtyard building behind a
// street one, a block split across two RNB records — and lending either id to
// the undecided rows would paint a diagnostic onto a building chosen by
// whichever row the register happened to return first.
//
// Everything here is pure and node-testable; the Cesium drawing lives in
// `dpeFrance.js` and the upstream resolution in the `/api/dpe` proxy.

import { DPE_LABELS } from './dpeFeed.js';
import { ringAreaM2, ringLabelAnchor, sanitisePolygonParts } from './ringGeometry.js';

/**
 * Sites the proxy will resolve a shape for, nearest the scan centre first.
 *
 * Each site costs ONE RNB call, and the cadastre answers for the whole box in
 * one. 60 is four times the 14 the densest measured box produced and still
 * bounds a 1 000 m radius scan of a diffuse commune, where the same 500 rows
 * spread over hundreds of hamlet addresses instead of piling onto thirteen.
 * Sites past the cap keep their badge and their card and get no outline, which
 * is the same degradation as a site the RNB does not know.
 */
export const DPE_SITE_MAX = 60;

/** A published letter, or null. Anything outside A–G is not a grade. */
export function dpeGradeOf(entry) {
  const letter = String(entry?.etiquetteDpe ?? '').toUpperCase();
  return DPE_LABELS.includes(letter) ? letter : null;
}

/**
 * Summarise every diagnostic that landed on one building.
 *
 * Pure, and the ONLY place the rule lives: the building theme's `reduce()`,
 * this module's grouping and `dpeFrance.js`'s badges all call it, so the colour
 * on a roof, the colour of a footprint and the letter on a badge cannot come
 * from three different answers.
 *
 * `grade` is the MODE — the letter held by the most diagnostics — and ties go
 * to the WORSE letter. The reasoning behind both, and the two rules that were
 * refused, are in the header of `dpeFrance.js`; it is written there because
 * that is where the paint is decided and the reader meets it.
 *
 * `grade` is null when no diagnostic published a letter. The building then
 * stays washed rather than being given a default, which is A1 applied to the
 * one thing this layer must never invent.
 *
 * @param {Array<object>} points Diagnostics on one building, any order.
 * @returns {{grade: ?string, votes: number, graded: number, ungraded: number,
 *   total: number, best: ?string, worst: ?string, spread: number,
 *   mixed: boolean, letters: Array<string>}}
 */
export function dpeBuildingSummary(points) {
  const counts = new Map();
  let graded = 0;
  let ungraded = 0;
  for (const point of points || []) {
    const letter = dpeGradeOf(point);
    if (!letter) { ungraded += 1; continue; }
    graded += 1;
    counts.set(letter, (counts.get(letter) || 0) + 1);
  }
  let grade = null;
  let votes = 0;
  let best = null;
  let worst = null;
  // A to G, taking a tie: the LAST letter to match the running maximum wins,
  // and the labels are ordered worst-last, so a tie resolves pessimistically
  // without a second comparison.
  for (const letter of DPE_LABELS) {
    const n = counts.get(letter) || 0;
    if (!n) continue;
    if (best === null) best = letter;
    worst = letter;
    if (n >= votes) { votes = n; grade = letter; }
  }
  const letters = DPE_LABELS.filter((letter) => counts.has(letter));
  const spread = best === null ? 0 : DPE_LABELS.indexOf(worst) - DPE_LABELS.indexOf(best);
  return {
    grade,
    votes,
    graded,
    ungraded,
    total: graded + ungraded,
    best,
    worst,
    spread,
    mixed: letters.length > 1,
    letters,
  };
}

/** The RNB identifier a row carries, trimmed, or null. */
function rnbOf(entry) {
  const id = String(entry?.rnb ?? '').trim();
  return id || null;
}

/** The BAN key a row carries, trimmed, or null. */
function banOf(entry) {
  const key = String(entry?.banId ?? '').trim();
  return key || null;
}

/**
 * The building identifier every row at one BAN address agrees on, per address.
 *
 * Exported for its own test: the REFUSAL is the part that matters, and a later
 * simplification to "take the first id you see" would restore the bug the
 * refusal exists for while every count in this module stayed the same.
 *
 * @param {Array<object>} entries Served diagnostics.
 * @returns {Map<string, string>} BAN key → the one RNB id, unanimous addresses
 *   only.
 */
export function unanimousRnbByAddress(entries) {
  const seen = new Map();
  for (const entry of entries || []) {
    const ban = banOf(entry);
    const rnb = rnbOf(entry);
    if (!ban || !rnb) continue;
    const known = seen.get(ban);
    if (known === undefined) seen.set(ban, rnb);
    else if (known !== rnb) seen.set(ban, null); // two buildings, one address
  }
  const out = new Map();
  for (const [ban, rnb] of seen) if (rnb) out.set(ban, rnb);
  return out;
}

/**
 * Group the served diagnostics into the things a map can point at.
 *
 * Sites come back sorted by their nearest diagnostic, so the proxy's shape
 * budget and the reader's eye meet the same order — the block under the camera
 * first.
 *
 * @param {Array<object>} entries Served diagnostics, in the register's order.
 * @returns {Array<object>} Sites: `{key, kind, rnb, banId, address, lon, lat,
 *   distanceM, points, summary}`. `kind` is `building`, `address` or `point`.
 */
export function groupDpeSites(entries) {
  const lent = unanimousRnbByAddress(entries);
  const sites = new Map();
  for (const entry of entries || []) {
    const ban = banOf(entry);
    const rnb = rnbOf(entry) || (ban ? lent.get(ban) ?? null : null);
    // A row with no coordinate is still grouped and still counted — it votes on
    // its building's letter exactly like its neighbours. It simply never gets a
    // badge, and `unplacedPoints` says how many did not.
    const hasPoint = Number.isFinite(entry?.lon) && Number.isFinite(entry?.lat);
    let key;
    let kind;
    if (rnb) { key = `rnb:${rnb}`; kind = 'building'; } else if (ban) { key = `ban:${ban}`; kind = 'address'; } else if (hasPoint) {
      key = `pt:${entry.lon.toFixed(6)},${entry.lat.toFixed(6)}`;
      kind = 'point';
    } else {
      key = 'pt:none';
      kind = 'point';
    }
    let site = sites.get(key);
    if (!site) {
      site = {
        key,
        kind,
        rnb,
        banId: ban,
        address: entry?.address ?? null,
        lon: hasPoint ? entry.lon : null,
        lat: hasPoint ? entry.lat : null,
        distanceM: Number.isFinite(entry?.distanceM) ? entry.distanceM : null,
        points: [],
      };
      sites.set(key, site);
    }
    // The site stands where its NEAREST placed diagnostic does, until a shape
    // replaces that with the building's own anchor. The register serves rows
    // nearest-first, so this keeps the first coordinate it saw.
    if (site.lon === null && hasPoint) { site.lon = entry.lon; site.lat = entry.lat; }
    if (site.address === null && entry?.address) site.address = entry.address;
    if (site.distanceM === null && Number.isFinite(entry?.distanceM)) {
      site.distanceM = entry.distanceM;
    }
    site.points.push(entry);
  }
  const out = [...sites.values()];
  for (const site of out) site.summary = dpeBuildingSummary(site.points);
  // Nearest first, and a site with no distance at all goes last rather than
  // first: `null` sorting as 0 would put the rows the register could not place
  // ahead of the block under the camera.
  out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  return out;
}

/**
 * Turn a GeoJSON Polygon / MultiPolygon into this repository's `parts` shape.
 *
 * `[[outer, ...holes], …]` with `[lon, lat]` vertices — what `sanitisePolygonParts`
 * cleans and what every polygon layer here draws from.
 *
 * @param {object|null|undefined} geometry
 * @returns {Array<Array<Array<number[]>>>} Empty when nothing usable.
 */
export function geometryParts(geometry) {
  const type = geometry?.type;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return [];
  if (type === 'Polygon') return sanitisePolygonParts([coords]);
  if (type === 'MultiPolygon') return sanitisePolygonParts(coords);
  return [];
}

/**
 * Where a shape's badge stands, and how much ground it covers.
 *
 * The anchor is `ringLabelAnchor` on the WIDEST part, not the centroid: a
 * building in an L or a U around a courtyard has a centroid in the courtyard,
 * and a letter standing on ground its own outline does not cover is the same
 * lie this layer was reported for in the first place.
 *
 * @param {Array<Array<Array<number[]>>>} parts Cleaned parts.
 * @returns {?{lon: number, lat: number, areaM2: number}}
 */
export function partsAnchor(parts) {
  let best = null;
  let bestArea = 0;
  let total = 0;
  for (const rings of parts || []) {
    const outer = rings?.[0];
    if (!Array.isArray(outer)) continue;
    let area = ringAreaM2(outer);
    for (let h = 1; h < rings.length; h += 1) area -= ringAreaM2(rings[h]);
    total += Math.max(0, area);
    if (area <= bestArea && best) continue;
    const anchor = ringLabelAnchor(rings);
    if (!anchor) continue;
    bestArea = area;
    best = anchor;
  }
  if (!best) return null;
  return { lon: best.lon, lat: best.lat, areaM2: Math.round(total) };
}

/**
 * How this site knows where it is, as the card has to say it.
 *
 * Four claims, and they are NOT interchangeable. The register naming a
 * building is a record; the RNB finding a building the geocode falls INSIDE is
 * a resolution; the RNB finding the nearest building some metres away is a
 * guess and prints its own distance; a BAN geocode with no building at all is
 * a point on a street. A card that printed one sentence for all four would let
 * the fourth borrow the first's authority.
 *
 * @param {object} site
 * @returns {?string} French, or null when there is nothing to disclose.
 */
export function dpeSitePlacementLine(site) {
  const shape = site?.shape;
  if (!shape) {
    return site?.kind === 'building'
      ? 'bâtiment nommé par le registre, emprise non publiée'
      : 'position BAN — géocodage à l’adresse, pas au bâtiment';
  }
  if (shape.via === 'id') return 'bâtiment nommé par le diagnostic (id RNB)';
  if (shape.via === 'inside') return 'bâtiment retrouvé sous le point BAN';
  if (shape.via === 'closest') {
    const d = Number.isFinite(shape.distanceM) ? Math.round(shape.distanceM) : null;
    return d !== null
      ? `bâtiment le plus proche du point BAN — ${d} m, déduction`
      : 'bâtiment le plus proche du point BAN — déduction';
  }
  return null;
}
