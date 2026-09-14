// src/data/dpeFrance.test.mjs
//
// Six questions, in the order they can make the map lie:
//
//   1. does the reduce rule paint a letter that EXISTS on the building — never
//      a mean of letters, and never an invented one on a tie;
//   2. can a reader tell a painted volume from an unmeasured one, measured in
//      ΔE76 against every wash the BD TOPO palette can produce — and does the
//      module's own header tell the truth about where the official ramp FAILS;
//   3. does the theme reach the volumes, with its precedence, its legend and
//      its "no data" wording, and does it leave when the layer leaves;
//   4. are the badges a supplement and not a replacement — full size with the
//      volumes off, quiet only where the roof already says the same letter, and
//      never touched while selected;
//   5. is every diagnostic that reaches no volume counted rather than swallowed
//      (A5): no coordinate, no footprint, no published letter;
//   6. does the row say how wide the scan was against how wide the city is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DPE_COLORS,
  DPE_THEME_ID,
  DPE_THEME_PRECEDENCE,
  _applyDpeBadgesForTest,
  _resetDpeThemeForTest,
  _seedDpeThemeForTest,
  dpeBuildingSummary,
  dpeMarkerSizePx,
  dpeRowControls,
  dpeSiteCardDescription,
  dpeSiteTitle,
  dpeSummarize,
  dpeThemeLegend,
} from './dpeFrance.js';
import { groupDpeSites } from './dpeSites.js';
import { DPE_LABELS } from './dpeFeed.js';
import {
  BUILDING_THEME_MIN_DELTA_E,
  cieLightness,
  clearAllBuildingThemes,
  deltaE76,
  getActiveBuildingTheme,
  parseCssRgb,
  registerBuildingTheme,
  unknownBuildingCss,
} from './buildingTheme.js';
import {
  _applyBdtopoThemeForTest,
  _bdtopoRowControlsForTest,
  _setBdtopoStateForTest,
} from './bdtopoBuildings.js';
import { BASE_SINK_M, BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';

/* ── fixtures ──────────────────────────────────────────────────────────── */

/** An axis-aligned rectangle as a closed `[lon, lat, ...]` ring. */
function box(id, west, south, east, north) {
  return {
    id,
    degrees: [west, south, east, south, east, north, west, north, west, south],
    holes: [],
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  };
}

/** A drawable BD TOPO record around one footprint. */
function record(footprint, { color = '#e8b96a', heightM = 20 } = {}) {
  return {
    ...footprint,
    color,
    baseM: 100,
    topM: 100 + heightM + BASE_SINK_M,
    tierId: 'residential',
  };
}

/**
 * Three neighbouring blocks of Lyon, 111 m apart in longitude so nothing can
 * accidentally land in the wrong one.
 */
const BLOCK_A = box('A', 4.800, 45.750, 4.801, 45.751);
const BLOCK_B = box('B', 4.802, 45.750, 4.803, 45.751);
const BLOCK_C = box('C', 4.804, 45.750, 4.805, 45.751);

/** A point safely inside a ring. */
function inside(footprint, nudge = 0) {
  return {
    lon: footprint.degrees[0] + 0.0004 + nudge * 0.00001,
    lat: footprint.degrees[1] + 0.0005,
  };
}

/**
 * One ADEME row as `projectDpe` shapes it.
 *
 * `ban` is what GROUPS it. Since sites replaced per-diagnostic badges these
 * fixtures have to carry an address, because that is what the register carries
 * and what decides which badge a row ends up under.
 */
function dpe(id, letter, footprint, index = 0, extra = {}) {
  const point = footprint ? inside(footprint, index) : { lon: null, lat: null };
  return {
    id,
    etiquetteDpe: letter,
    etiquetteGes: null,
    address: `${id} rue de la Mesure`,
    banId: null,
    rnb: null,
    builtYear: null,
    surfaceM2: null,
    annualCostEur: null,
    consoKwhM2: null,
    gesKgM2: null,
    issuedOn: '2024-03-01',
    distanceM: 40,
    ...point,
    ...extra,
  };
}

/**
 * The payload of one scan.
 *
 * Four addresses, three blocks, and the disagreement the badge rule exists for:
 *
 *   - `ban-A`, five diagnostics inside BLOCK_A, mode **D**, one of them
 *     ungraded;
 *   - `ban-A2`, four diagnostics ALSO inside BLOCK_A — a courtyard address
 *     whose geocode lands on the same footprint — all **G**. The FOOTPRINT
 *     therefore holds 4 G against 3 D and the theme paints it G, while the
 *     `ban-A` site's own mode stays D. That is the real case the quiet rule has
 *     to keep telling apart, and it is no longer hypothetical: it is what the
 *     BAN geocode does for a building behind a building;
 *   - `ban-B`, four diagnostics in BLOCK_B, a tie between C and E;
 *   - BLOCK_C has no diagnostic at all;
 *
 * and two rows that fail to reach a volume in the two ways the seam counts
 * separately.
 */
function scanEntries() {
  const ban = (key) => ({ banId: key, address: `${key} rue de la Mesure` });
  return [
    dpe('a1', 'D', BLOCK_A, 0, ban('ban-A')),
    dpe('a2', 'D', BLOCK_A, 1, ban('ban-A')),
    dpe('a3', 'D', BLOCK_A, 2, ban('ban-A')),
    dpe('a4', 'F', BLOCK_A, 3, ban('ban-A')),
    dpe('a5', null, BLOCK_A, 4, ban('ban-A')),
    dpe('c1', 'G', BLOCK_A, 5, ban('ban-A2')),
    dpe('c2', 'G', BLOCK_A, 6, ban('ban-A2')),
    dpe('c3', 'G', BLOCK_A, 7, ban('ban-A2')),
    dpe('c4', 'G', BLOCK_A, 8, ban('ban-A2')),
    dpe('b1', 'C', BLOCK_B, 0, ban('ban-B')),
    dpe('b2', 'C', BLOCK_B, 1, ban('ban-B')),
    dpe('b3', 'E', BLOCK_B, 2, ban('ban-B')),
    dpe('b4', 'E', BLOCK_B, 3, ban('ban-B')),
    // Geocoded to the middle of the street: a real diagnostic on no building.
    dpe('street', 'G', null, 0, { lon: 4.9, lat: 45.75, ...ban('ban-street') }),
    // No coordinate at all, which is a different admission.
    dpe('nowhere', 'G', null, 0, ban('ban-nowhere')),
  ];
}

/** Seed the volume layer with the three blocks. */
function seedBuildings(footprints = [BLOCK_A, BLOCK_B, BLOCK_C]) {
  const records = new Map();
  for (const footprint of footprints) records.set(footprint.id, record(footprint));
  _setBdtopoStateForTest({ records });
}

/**
 * A data source that answers `getById` the way Cesium's does, holding ONE
 * badge per site — which is what the layer now draws.
 */
function fakeDataSource(entries) {
  const byId = new Map();
  for (const site of groupDpeSites(entries)) {
    if (!Number.isFinite(site.lon)) continue;
    const size = site.summary.grade ? 20 : 16;
    byId.set(`dpe:${site.key}`, new Cesium.Entity({
      id: `dpe:${site.key}`,
      billboard: { width: size, height: size },
    }));
  }
  return { byId, entities: { getById: (id) => byId.get(id) || undefined } };
}

/** The width the badge of one BAN address is currently drawn at. */
function widthOf(source, ban) {
  const billboard = source.byId.get(`dpe:ban:${ban}`)?.billboard;
  return Number(billboard?.width?.getValue?.(Cesium.JulianDate.now()) ?? billboard?.width);
}

function reset() {
  _resetDpeThemeForTest();
  clearAllBuildingThemes();
  _setBdtopoStateForTest({ records: new Map() });
}

/* ── 1. the rule ───────────────────────────────────────────────────────── */

/**
 * The whole reason this layer needed a rule of its own. The module header of
 * `dpeFeed.js` has always said the mean of a street's letters is not a property
 * of the street; a building is a smaller street and the sentence still holds.
 */
test('the painted letter is one the building actually holds', () => {
  const summary = dpeBuildingSummary([
    { etiquetteDpe: 'B' }, { etiquetteDpe: 'B' }, { etiquetteDpe: 'F' },
  ]);
  assert.equal(summary.grade, 'B', 'the mode, not the mean');
  assert.equal(summary.votes, 2);
  assert.equal(summary.best, 'B');
  assert.equal(summary.worst, 'F');
  assert.equal(summary.spread, 4);
  assert.equal(summary.mixed, true);
  // The arithmetic mean of B(1) and F(5) over three rows is D — a letter no
  // diagnostic on this building ever carried.
  assert.notEqual(summary.grade, 'D');
});

test('a tie goes to the worse letter, whatever order the register sent', () => {
  const forwards = dpeBuildingSummary([
    { etiquetteDpe: 'C' }, { etiquetteDpe: 'C' }, { etiquetteDpe: 'E' }, { etiquetteDpe: 'E' },
  ]);
  const backwards = dpeBuildingSummary([
    { etiquetteDpe: 'E' }, { etiquetteDpe: 'C' }, { etiquetteDpe: 'E' }, { etiquetteDpe: 'C' },
  ]);
  assert.equal(forwards.grade, 'E');
  assert.equal(backwards.grade, 'E', 'row order cannot move the paint');
});

test('a building with no published letter is not graded at all', () => {
  const summary = dpeBuildingSummary([{ etiquetteDpe: null }, { etiquetteDpe: '' }]);
  assert.equal(summary.grade, null);
  assert.equal(summary.graded, 0);
  assert.equal(summary.ungraded, 2);
  assert.equal(summary.total, 2);
  assert.equal(summary.mixed, false);
});

test('an unpublishable letter is refused rather than snapped to the nearest', () => {
  const summary = dpeBuildingSummary([{ etiquetteDpe: 'H' }, { etiquetteDpe: 'D' }]);
  assert.equal(summary.grade, 'D');
  assert.equal(summary.graded, 1);
  assert.equal(summary.ungraded, 1, 'H is counted as ungraded, never folded into G');
});

test('ungraded diagnostics do not dilute the mode', () => {
  const summary = dpeBuildingSummary([
    { etiquetteDpe: null }, { etiquetteDpe: null }, { etiquetteDpe: 'D' },
  ]);
  assert.equal(summary.grade, 'D');
  assert.equal(summary.votes, 1);
  assert.equal(summary.total, 3);
});

/* ── 2. the palette against "nobody measured this one" (A1) ────────────── */

/**
 * The washes an unjoined volume can actually take: every BD TOPO usage colour,
 * washed by `unknownBuildingCss`, then darkened by the height shading the
 * volume layer keeps on unpainted volumes — `darken(0.42 * (1 - t))`, t in
 * 0..1, so the factor runs 0.42 at ground level to 0 at 38 m.
 */
function washColours() {
  const out = [];
  for (const tier of BDTOPO_USAGE_TIERS) {
    const washed = parseCssRgb(unknownBuildingCss(tier.color));
    for (const factor of [0, 0.21, 0.42]) {
      out.push(washed.map((channel) => Math.round(channel * (1 - factor))));
    }
  }
  return out;
}

test('no DPE class can be read as an unmeasured volume', () => {
  const washes = washColours();
  let worst = Infinity;
  for (const letter of DPE_LABELS) {
    const rgb = parseCssRgb(DPE_COLORS[letter]);
    for (const wash of washes) worst = Math.min(worst, deltaE76(rgb, wash));
  }
  assert.ok(
    worst >= BUILDING_THEME_MIN_DELTA_E,
    `closest class to a wash is ΔE76 ${worst.toFixed(1)}, under the `
      + `${BUILDING_THEME_MIN_DELTA_E} the seam asks for`,
  );
  // The number the module header quotes. Locked so a palette edit anywhere has
  // to come back and re-argue it.
  assert.ok(worst > 58 && worst < 59, `expected ~58.5, measured ${worst.toFixed(1)}`);
});

/**
 * The half of the official palette that does NOT work, asserted so the header
 * cannot quietly stop being true. B and F are the same grey; that is why the
 * badge draws the letter as a SHAPE and why it is kept when the volume is
 * painted.
 */
test('the official ramp fails the greyscale test, and the badge is why that is survivable', () => {
  const lightness = Object.fromEntries(
    DPE_LABELS.map((letter) => [letter, cieLightness(parseCssRgb(DPE_COLORS[letter]))]),
  );
  assert.ok(
    Math.abs(lightness.B - lightness.F) < 1,
    'B and F should be indistinguishable in grey, measured '
      + `${Math.abs(lightness.B - lightness.F).toFixed(1)} L*`,
  );
  assert.ok(lightness.C < lightness.D, 'the ramp climbs to D...');
  assert.ok(lightness.E < lightness.D, '...and comes back down, so it is not a ladder');
});

/* ── 3. the theme reaches the volumes, and leaves ──────────────────────── */

test('the theme registers with its precedence and its own no-data wording', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const active = getActiveBuildingTheme();
  assert.equal(active.id, DPE_THEME_ID);
  assert.equal(active.precedence, DPE_THEME_PRECEDENCE);
  assert.equal(active.precedence, 10);
  assert.equal(active.unknownLabel, 'sans DPE dans le rayon scanné');
});

test('a theme that outranks DPE takes the map, and DPE takes it back', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  registerBuildingTheme({
    id: 'rival-low',
    label: 'Rival',
    precedence: 20,
    points: [],
    reduce: () => 1,
    colorFor: () => '#ffffff',
  });
  assert.equal(getActiveBuildingTheme().id, DPE_THEME_ID, 'precedence 10 beats 20');

  registerBuildingTheme({
    id: 'rival-high',
    label: 'Rival',
    precedence: 5,
    points: [],
    reduce: () => 1,
    colorFor: () => '#ffffff',
  });
  assert.equal(getActiveBuildingTheme().id, 'rival-high', 'and loses to 5');
});

test('the volumes take the letter, and the ones nobody diagnosed do not', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const { paint } = _applyBdtopoThemeForTest();
  assert.equal(paint.themeId, DPE_THEME_ID);
  assert.equal(
    paint.colorById.get('A'), DPE_COLORS.G,
    'the mode of block A — four G from the courtyard address against three D from the street',
  );
  assert.equal(paint.colorById.get('B'), DPE_COLORS.E, 'the tie, resolved pessimistically');
  assert.equal(paint.colorById.has('C'), false, 'no diagnostic, no grade');
  assert.equal(paint.painted, 2);
  assert.equal(paint.unpainted, 1);
  assert.equal(paint.buildings, 3);
});

test('the legend carries all seven rungs, counted, even the empty ones', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());
  const { paint } = _applyBdtopoThemeForTest();

  const rows = paint.legend.filter((row) => DPE_LABELS.includes(row.label));
  assert.equal(rows.length, 7, 'a frozen domain scale is published whole (C1)');
  assert.equal(rows.find((row) => row.label === 'G').count, 1, 'block A');
  assert.equal(rows.find((row) => row.label === 'E').count, 1, 'block B');
  assert.equal(rows.find((row) => row.label === 'A').count, 0, 'an empty rung stays on the ladder');

  // What the reader actually sees: the volume layer's own row, which replaces
  // its six usage bands with this ramp and appends the wording for a volume the
  // theme could not speak about.
  const { legend } = _bdtopoRowControlsForTest();
  const unknown = legend.find((row) => row.label === 'sans DPE dans le rayon scanné');
  assert.equal(unknown.count, 1, 'block C, loaded and never diagnosed');
  const stray = legend.find((row) => row.label === 'points sans bâtiment');
  assert.equal(stray.count, 2, 'the street row and the row with no coordinate');
});

test('the legend names the blocks whose diagnostics disagree', () => {
  const legend = dpeThemeLegend([
    { grade: 'D', mixed: true }, { grade: 'D', mixed: false }, { grade: 'E', mixed: false },
  ]);
  const d = legend.find((row) => row.label === 'D');
  const e = legend.find((row) => row.label === 'E');
  assert.equal(d.count, 2);
  assert.match(d.blurb, /1 immeuble peint D n'est pas unanime/);
  assert.equal(e.count, 1);
  assert.doesNotMatch(e.blurb, /unanime/, 'a class with no dispute says nothing about dispute');
});

test('a scan with nothing to paint leaves the city its own colours', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest([dpe('u1', null, BLOCK_A, 0), dpe('u2', null, BLOCK_B, 0)]);
  assert.equal(getActiveBuildingTheme(), null, 'no letter anywhere is not a grey city');
});

test('switching the layer off takes the paint with it', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());
  assert.equal(getActiveBuildingTheme().id, DPE_THEME_ID);

  _resetDpeThemeForTest();
  assert.equal(getActiveBuildingTheme(), null);
  const { paint } = _applyBdtopoThemeForTest();
  assert.equal(paint, null, 'the volumes are back to their usage bands');
});

/* ── 4. the badge is a supplement, not a replacement ───────────────────── */

test('one address draws one badge, however many diagnostics stand behind it', (t) => {
  t.after(reset);
  reset();
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });

  // 15 diagnostics, 5 addresses, 4 of them placed — and `ban-nowhere` has no
  // coordinate, so it gets no badge at all. Before the grouping this was 14
  // billboards on 14 coordinates, nine of them inside one block.
  assert.equal(entries.length, 15);
  assert.equal(source.byId.size, 4, 'one badge per placed address');
  assert.equal(widthOf(source, 'ban-A'), 20);
  assert.equal(source.byId.has('dpe:ban:ban-nowhere'), false, 'nothing is sent to sea');
  // The rows are all still there: grouping draws fewer marks, it never drops a
  // diagnostic. Nine of the fifteen are inside BLOCK_A alone.
  const sites = groupDpeSites(entries);
  assert.equal(sites.reduce((sum, site) => sum + site.points.length, 0), 15);
  assert.equal(sites.find((site) => site.key === 'ban:ban-A2').points.length, 4);
});

test('with the volumes off, every badge keeps the size it always had', (t) => {
  t.after(reset);
  reset();
  // No footprints seeded: this is `Bâti 3D` switched off.
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  const join = _seedDpeThemeForTest(entries, { dataSource: source });
  _applyDpeBadgesForTest();

  assert.equal(join.buildings, 0);
  assert.equal(widthOf(source, 'ban-A'), 20, 'a published letter still draws at 20 px');
  assert.equal(widthOf(source, 'ban-A2'), 20, 'and so does the one that agreed with a roof');
  assert.equal(widthOf(source, 'ban-B'), 20);
});

test('a site whose diagnostics published no letter draws the smaller grey badge', (t) => {
  t.after(reset);
  reset();
  const entries = [
    dpe('u1', null, BLOCK_A, 0, { banId: 'ban-U', address: 'ban-U rue de la Mesure' }),
    dpe('u2', null, BLOCK_A, 1, { banId: 'ban-U', address: 'ban-U rue de la Mesure' }),
  ];
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });
  _applyDpeBadgesForTest();
  assert.equal(widthOf(source, 'ban-U'), 16, 'the one thing no paint can express');
});

test('a badge goes quiet only where the volume already says its letter', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });
  _applyDpeBadgesForTest();

  // BLOCK_A holds both addresses: four G against three D, so the footprint is
  // painted G. The courtyard address agrees with it and falls silent; the
  // street address does not and keeps every pixel it had.
  assert.equal(widthOf(source, 'ban-A2'), 12, 'agrees with the roof');
  assert.equal(widthOf(source, 'ban-A'), 20, 'a D site on a G volume is the disagreement');
  // Block B is painted E — the tie, resolved pessimistically — and its one
  // address holds exactly the rows that painted it.
  assert.equal(widthOf(source, 'ban-B'), 12);
  // Off every footprint: the volume says nothing about it.
  assert.equal(widthOf(source, 'ban-street'), 20);
});

test('the selected badge is left exactly as the operator enlarged it', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });
  source.byId.get('dpe:ban:ban-A2').billboard.width = 26;
  source.byId.get('dpe:ban:ban-A2').billboard.height = 26;

  _applyDpeBadgesForTest('dpe:ban:ban-A2');
  assert.equal(widthOf(source, 'ban-A2'), 26, 'a selection outranks the theme until Escape');
  assert.equal(widthOf(source, 'ban-B'), 12, 'its neighbours are still re-sized');
});

test('the size rule is one statement and reads the same everywhere', () => {
  assert.equal(dpeMarkerSizePx('D', null), 20);
  assert.equal(dpeMarkerSizePx('D', 'D'), 12);
  assert.equal(dpeMarkerSizePx('F', 'D'), 20);
  assert.equal(dpeMarkerSizePx(null, 'D'), 16);
  assert.equal(dpeMarkerSizePx(null, null), 16);
  assert.equal(dpeMarkerSizePx('Z', null), 16, 'a letter outside A–G is not a grade');
});

/* ── the card answers for the BUILDING, not for one flat ───────────────── */

test('the card states the spread of the site, and never hides it behind the paint', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const join = _seedDpeThemeForTest(entries);
  const sites = groupDpeSites(entries);
  const byKey = new Map(sites.map((site) => [site.key, site]));

  const streetSide = byKey.get('ban:ban-A');
  const painted = join.byPoint.get('a1');
  const card = dpeSiteCardDescription(streetSide, painted, true);
  assert.match(card, /^5 DPE, de D à F, majorité D/, 'the range leads, as the first line');
  assert.match(card, /1 sans étiquette publiée/);
  assert.match(card, /1 passoire \(F ou G\)/);
  // The volume only earns a line when it disagrees — and here it does.
  assert.match(card, /volume Bâti 3D peint G/);

  const unanimous = dpeSiteCardDescription({
    points: [{ etiquetteDpe: 'D' }, { etiquetteDpe: 'D' }],
    summary: dpeBuildingSummary([{ etiquetteDpe: 'D' }, { etiquetteDpe: 'D' }]),
  });
  assert.match(unanimous, /^2 DPE, tous D/);
  assert.doesNotMatch(unanimous, /passoire/, 'a D block has none, and says nothing');
});

test('the card names the ground it is drawn on, and how it got there', () => {
  const site = {
    address: '93 rue du Chevaleret',
    kind: 'building',
    distanceM: 57,
    points: [{ etiquetteDpe: 'E', annualCostEur: 900 }, { etiquetteDpe: 'E', annualCostEur: 700 }],
    summary: dpeBuildingSummary([{ etiquetteDpe: 'E' }, { etiquetteDpe: 'E' }]),
    shape: { via: 'id', rnbId: 'Q3TWB1672WV4', areaM2: 143, parts: [] },
    parcel: { idu: '75113000BI0020', via: 'idu', contenanceM2: 261 },
  };
  const card = dpeSiteCardDescription(site);
  assert.match(card, /emprise 143 m² au sol/);
  assert.match(card, /parcelle 75113000BI0020 — 261 m² cadastrés/);
  assert.match(card, /bâtiment nommé par le diagnostic \(id RNB\)/);
  assert.match(card, /700 €\/an estimés \(médiane du site\)/, 'a median, and it says so');
  assert.equal(dpeSiteTitle(site), '93 rue du Chevaleret — 2 DPE');
});

test('a site on no loaded footprint says so, and only when there were any', () => {
  const site = {
    address: 'quelque part',
    points: [{ etiquetteDpe: 'G' }],
    summary: dpeBuildingSummary([{ etiquetteDpe: 'G' }]),
    distanceM: 12,
  };
  assert.match(dpeSiteCardDescription(site, null, true), /hors des emprises BD TOPO chargées/);
  assert.doesNotMatch(
    dpeSiteCardDescription(site, null, false),
    /hors des emprises/,
    'with the volumes off that sentence would be about Bâti 3D, not about the DPE',
  );
});

/* ── 5. everything that reaches no volume is counted (A5) ──────────────── */

test('the three ways a diagnostic misses a volume are counted apart', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const join = _seedDpeThemeForTest(scanEntries());

  assert.equal(join.matchedPoints, 13, 'the thirteen rows inside a footprint');
  assert.equal(join.unmatchedPoints, 1, 'geocoded to the street');
  assert.equal(join.unplacedPoints, 1, 'no coordinate published at all');
  assert.equal(join.ungradedPoints, 1, 'present, and unable to paint anything');
  assert.equal(join.buildings, 3);
  assert.equal(join.painted, 2);
  assert.equal(join.mixed, 2, 'both painted blocks are summaries, not verdicts');
});

test('a row with an empty coordinate is never sent to sea', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const join = _seedDpeThemeForTest([dpe('empty', 'D', null, 0, { lon: '', lat: '' })]);
  assert.equal(join.unplacedPoints, 1);
  assert.equal(join.unmatchedPoints, 0, 'Number("") is 0 and 0,0 is the Gulf of Guinea');
});

test('the stats publish painted over loaded, not just painted', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);
  const distribution = { D: 3, F: 1, C: 2, E: 2, G: 2 };
  const stats = dpeSummarize({ entries, total: 2805, distribution });

  assert.equal(stats.themePainting, true);
  assert.equal(stats.themePainted, 2);
  assert.equal(stats.themeBuildings, 3);
  assert.equal(stats.themeUnpainted, 1);
  assert.equal(stats.themeUnmatchedPoints, 1);
  assert.equal(stats.themeUnplacedPoints, 1);
  assert.equal(stats.themeUngradedPoints, 1);
});

/* ── 6. the row says how wide the scan was ─────────────────────────────── */

test('the coverage line states the truncation and the paint', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);

  const truncated = dpeSummarize({ entries, total: 2805, distribution: {} });
  assert.match(truncated.coverage, /15 DPE servis sur 2\s?805 dans 200 m/);
  assert.match(truncated.coverage, /les plus proches du centre/);
  assert.match(truncated.coverage, /2 volumes peints sur 3 chargés/);
  // The grouping, said out loud: fifteen diagnostics, five addresses, and how
  // many of those five the RNB could put an outline under.
  assert.match(truncated.coverage, /5 adresses · 0 avec emprise bâtie/);

  const whole = dpeSummarize({ entries, total: 15, distribution: {} });
  assert.doesNotMatch(whole.coverage, /servis sur/, 'nothing was dropped, so nothing is claimed');
});

test('with the volumes off the row says nothing about painting', (t) => {
  t.after(reset);
  reset();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);
  const stats = dpeSummarize({ entries, total: 11, distribution: {} });
  assert.equal(stats.themePainting, false);
  assert.doesNotMatch(stats.coverage, /peint/);
});

test('the row legend gives the grey badge the entry it never had', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const { legend } = dpeRowControls({ distribution: { D: 3, F: 1, C: 2, E: 2, G: 2 } });
  assert.equal(legend.length, 8, 'seven rungs and the absence of a rung');
  assert.equal(legend.find((row) => row.label === 'D').count, 3, 'this row counts DIAGNOSTICS');
  const ungraded = legend.find((row) => row.label === 'étiquette non publiée');
  assert.equal(ungraded.count, 1);
  assert.equal(ungraded.color, '#7c8aa0');
});
