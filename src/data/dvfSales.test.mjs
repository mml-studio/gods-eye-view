// src/data/dvfSales.test.mjs
//
// Two things are pinned here.
//
// 1. THE C1 CONFORMITY TEST, written verbatim in docs/CARTOGRAPHIE.md: "cadrer
//    une zone, capturer ; élargir le cadrage pour faire entrer des valeurs
//    extrêmes ; la zone initiale a-t-elle changé de couleur ?" It must answer
//    no. Until 2026-09-03 it answered yes, and the fixture below reproduces the
//    old behaviour before proving the new one.
//
// 2. THE BUILDING THEME: what one volume says when several sales landed on it,
//    what it says when the last of them cannot be priced, and that the layer
//    hands the volumes back when it is switched off.
//
// Runs under plain `node --test`: the colour arithmetic, the reduction and the
// registry are all pure, and the layer's own module imports Cesium without
// needing a GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  communeReference,
  groupMutations,
  parseDvfCsv,
  percentile,
  selectNearbySales,
} from './dvfFeed.js';
import {
  BUILDING_THEME_MIN_DELTA_E,
  clearAllBuildingThemes,
  deltaE76,
  getActiveBuildingTheme,
  parseCssRgb,
  registerBuildingTheme,
  resolveBuildingThemePaint,
  unknownBuildingCss,
} from './buildingTheme.js';
import { BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';
import * as Cesium from 'cesium';
import dvfSalesLayer, {
  _dvfSetThemePayloadForTest,
  _dvfWithdrawIfDormantForTest,
  COLOR_NO_BASIS,
  COLOR_NO_RATIO,
  DVF_LAYER_ID,
  DVF_RATIO_BREAKS,
  DVF_RATIO_CLASSES,
  DVF_THEME_PRECEDENCE,
  DVF_TYPE_FILTERS,
  countCellsByClass,
  drawDvfParcels,
  dvfCellClass,
  dvfCellColorCss,
  dvfCellDisclosure,
  dvfCellLegendNote,
  dvfCellReference,
  dvfLegendDisclosure,
  dvfLegendEntries,
  dvfLegendNote,
  dvfMostRecentSale,
  dvfReference,
  dvfSaleCard,
  dvfSaleRecord,
  dvfVoiceSummary,
  dvfYearsLabel,
  filterSalesByType,
  saleColorCss,
  saleRatioClass,
  saleRatioPrice,
} from './dvfSales.js';

const CSV = readFileSync(new URL('./fixtures/dvf-75113-2024-sample.csv', import.meta.url), 'utf8');
const MUTATIONS = groupMutations(parseDvfCsv(CSV));

/** Avenue de France, Paris 13e — the point the fixture was captured around. */
const AVENUE_DE_FRANCE = { lon: 2.3760, lat: 48.8300 };
/** Rue de Tolbiac, 1.5 km west, same arrondissement, same editions. */
const TOLBIAC = { lon: 2.35443, lat: 48.822897 };
/** Boulevard Auguste-Blanqui, 1.9 km north-west, still Paris 13e. */
const BLANQUI = { lon: 2.348481, lat: 48.835292 };

/** Build the payload shape the proxy serves, for a given origin and radius. */
function payloadFor(origin, radiusM, years = [2024]) {
  const { sales, summary } = selectNearbySales(MUTATIONS, origin, radiusM);
  return {
    commune: { code: '75113', name: 'Paris' }, years, sales, summary,
  };
}

/* ── C1: the denominator no longer moves with the camera ─────────────────── */

test('the commune median is the same number from three points and three radii', () => {
  const seen = new Set();
  for (const origin of [AVENUE_DE_FRANCE, TOLBIAC, BLANQUI]) {
    for (const radius of [50, 300, 1000]) {
      const reference = dvfReference(payloadFor(origin, radius));
      seen.add(reference.medianPrixM2);
      assert.equal(reference.basis, 'commune');
      // Named, not just stable: the number is useless to a reader who cannot
      // say what territory it belongs to.
      assert.equal(reference.name, 'Paris 13e Arrondissement');
      assert.equal(reference.code, '75113');
    }
  }
  assert.deepEqual([...seen], [8956], 'one denominator for nine framings');
});

test('C1 — widening the framing does not repaint a sale', () => {
  // The doctrine's own test, on a synthetic commune because the captured sample
  // is too thin to hold two price regimes inside the 1 km radius ceiling: a
  // cheap block at the origin, a dear one 800 m away that a wider radius pulls
  // in. Prices are Paris-scale so the ratios are the ones the ramp really sees.
  const near = [4000, 4200, 4600].map((prixM2, i) => ({
    id: `near-${i}`, prixM2, lon: 2.30, lat: 48.85, commune: 'Testville', communeCode: '99999',
  }));
  const far = [16000, 16500, 17000, 17500].map((prixM2, i) => ({
    id: `far-${i}`, prixM2, lon: 2.3098, lat: 48.85, commune: 'Testville', communeCode: '99999',
  }));
  const all = [...near, ...far];
  const origin = { lon: 2.30, lat: 48.85 };

  const tight = selectNearbySales(all, origin, 300);
  const wide = selectNearbySales(all, origin, 1000);
  assert.equal(tight.sales.length, 3);
  assert.equal(wide.sales.length, 7, 'the wider framing really does bring the extremes in');

  // THE OLD RULE — the median of what is on screen — flipped the colour of a
  // sale that had not changed. This is the regression being fixed, asserted so
  // that nobody reintroduces the "local median" argument without seeing it.
  const oldTight = saleColorCss(4600, tight.summary.medianPrixM2);
  const oldWide = saleColorCss(4600, wide.summary.medianPrixM2);
  assert.notEqual(oldTight, oldWide);
  assert.equal(oldTight, '#ffb03d', '4 600 €/m² was "+5 to +25 %" against a 4 200 local median');
  assert.equal(oldWide, '#3dd6c4', 'and "more than 25 % below" once the dear block entered the view');

  // THE NEW RULE. Same sale, same colour, whatever the framing.
  const tightRef = dvfReference({ summary: tight.summary, commune: null, years: [2024] });
  const wideRef = dvfReference({ summary: wide.summary, commune: null, years: [2024] });
  assert.equal(tightRef.medianPrixM2, wideRef.medianPrixM2);
  assert.equal(
    saleColorCss(4600, tightRef.medianPrixM2),
    saleColorCss(4600, wideRef.medianPrixM2),
  );
  // And every one of the seven keeps its class across both framings.
  for (const sale of all) {
    assert.equal(
      saleColorCss(sale.prixM2, tightRef.medianPrixM2),
      saleColorCss(sale.prixM2, wideRef.medianPrixM2),
      `${sale.id} must not change colour when the framing does`,
    );
  }
});

test('the old denominator painted both extremes of the arrondissement "average"', () => {
  // Measured on the real fixture, and the reason this was not a theoretical
  // objection: park the camera on the dearest sale of the sample and the local
  // median IS that sale, so it came out at 1.00 and was drawn yellow — the same
  // yellow as the cheapest sale, for the same reason, 1.9 km away.
  for (const [origin, prixM2] of [[TOLBIAC, 12406], [BLANQUI, 6797]]) {
    const { summary } = selectNearbySales(MUTATIONS, origin, 300);
    assert.equal(summary.medianPrixM2, prixM2, 'a median of one sale is that sale');
    assert.equal(saleColorCss(prixM2, summary.medianPrixM2), '#ffe066', 'painted "at the median"');
  }
  const reference = dvfReference(payloadFor(AVENUE_DE_FRANCE, 300));
  assert.equal(saleColorCss(12406, reference.medianPrixM2), '#ff6b4a', '1,39 × the commune → red');
  assert.equal(saleColorCss(6797, reference.medianPrixM2), '#7ed957', '0,76 × the commune → green');
});

test('the six comparables of the fixture spread across four classes, not one', () => {
  const median = communeReference(MUTATIONS).medianPrixM2;
  const classes = [6797, 7182, 8857, 9054, 10464, 12406]
    .map((price) => saleRatioClass(price, median).id);
  assert.deepEqual(classes, ['low', 'low', 'at-median', 'at-median', 'high', 'very-high']);
});

test('the class breaks are frozen ratios, never quantiles of the sample', () => {
  assert.deepEqual([...DVF_RATIO_BREAKS], [1.25, 1.05, 0.95, 0.75]);
  assert.deepEqual(DVF_RATIO_CLASSES.map((entry) => entry.min), [1.25, 1.05, 0.95, 0.75, -Infinity]);
  assert.ok(Object.isFrozen(DVF_RATIO_CLASSES) && Object.isFrozen(DVF_RATIO_CLASSES[0]));
  // A quantile classification would put ~20 % of the sample in each class. The
  // fixture's six comparables do not, and must not.
  const median = communeReference(MUTATIONS).medianPrixM2;
  const counts = new Map();
  for (const price of [6797, 7182, 8857, 9054, 10464, 12406]) {
    const id = saleRatioClass(price, median).id;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  assert.equal(counts.get('very-low') ?? 0, 0, 'an empty class stays empty rather than being filled');
});

/* ── A1: three outcomes, three signs ─────────────────────────────────────── */

test('a price, an unpriceable sale and a missing denominator are three colours', () => {
  const median = 8956;
  assert.equal(saleColorCss(9054, median), '#ffe066');
  assert.equal(saleColorCss(null, median), COLOR_NO_RATIO);
  assert.equal(saleColorCss(9054, null), COLOR_NO_BASIS);
  const distinct = new Set([saleColorCss(9054, median), COLOR_NO_RATIO, COLOR_NO_BASIS]);
  assert.equal(distinct.size, 3);
});

test('a mutation declared at €0 is not a bargain, it is an absence of price', () => {
  assert.equal(saleRatioPrice({ prixM2: 0 }), null);
  assert.equal(saleRatioPrice({ prixM2: null }), null);
  assert.equal(saleRatioPrice({ prixM2: 9054 }), 9054);
  assert.equal(saleColorCss(0, 8956), COLOR_NO_RATIO, 'never painted "25 % below the commune"');
});

test('no denominator implies nothing on screen to colour — the fallback is unreachable', () => {
  // The claim the header makes, asserted rather than trusted: the served sales
  // are a subset of the mutations the reference is computed from, so a commune
  // with no comparable cannot serve a sale that has one.
  const unpriceable = MUTATIONS.map((mutation) => ({ ...mutation, prixM2: null }));
  const reference = communeReference(unpriceable);
  assert.equal(reference.basis, 'none');
  assert.equal(reference.medianPrixM2, null);
  const { sales } = selectNearbySales(unpriceable, AVENUE_DE_FRANCE, 1000);
  assert.ok(sales.length > 0, 'sales are still drawn — they happened');
  for (const sale of sales) {
    assert.equal(saleRatioPrice(sale), null);
    assert.equal(saleColorCss(saleRatioPrice(sale), reference.medianPrixM2), COLOR_NO_RATIO);
  }
});

test('every colour this layer paints stays clear of the "no data" wash', () => {
  // The volumes are shared with `buildingTheme.js`, whose whole A1 argument is
  // that an unjoined volume cannot be mistaken for a graded one. That holds for
  // the wash AND for its height shading, which darkens it by up to 42 %.
  const references = [];
  for (const tier of BDTOPO_USAGE_TIERS) {
    const washed = parseCssRgb(unknownBuildingCss(tier.color));
    for (let percent = 0; percent <= 42; percent += 1) {
      references.push(washed.map((channel) => channel * (1 - percent / 100)));
    }
  }
  const palette = [...DVF_RATIO_CLASSES.map((entry) => entry.color), COLOR_NO_RATIO, COLOR_NO_BASIS];
  for (const css of palette) {
    const rgb = parseCssRgb(css);
    const worst = Math.min(...references.map((reference) => deltaE76(rgb, reference)));
    assert.ok(worst > BUILDING_THEME_MIN_DELTA_E, `${css} is ΔE76 ${worst.toFixed(1)} from a wash`);
  }
  // The measurement that moved the neutral: the previous `#7c8aa0` sat exactly
  // on the threshold, which is why it is not the colour any more.
  const old = Math.min(...references.map((reference) => deltaE76(parseCssRgb('#7c8aa0'), reference)));
  assert.ok(old <= BUILDING_THEME_MIN_DELTA_E, `#7c8aa0 measured ΔE76 ${old.toFixed(1)}`);
});

test('adjacent classes of the ramp stay separable (B3)', () => {
  for (let i = 1; i < DVF_RATIO_CLASSES.length; i += 1) {
    const distance = deltaE76(
      parseCssRgb(DVF_RATIO_CLASSES[i - 1].color),
      parseCssRgb(DVF_RATIO_CLASSES[i].color),
    );
    assert.ok(distance > 10, `${DVF_RATIO_CLASSES[i].id} is ΔE76 ${distance.toFixed(1)} from its neighbour`);
  }
});

/* ── D1: the legend names the denominator ────────────────────────────────── */

test('the denominator is a sentence above the classes, never a class', () => {
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  const reference = dvfReference(payload);
  // The block's own line: the territory, the number, the editions, and the
  // rule that froze the breaks. Nothing on the map is painted in it, so it is
  // not an entry of the key — it is what the key is divided by.
  const note = dvfLegendNote(reference);
  assert.match(note, /Paris 13e Arrondissement/);
  assert.match(note, /8\D?956/, 'the number itself, not only the word "médian"');
  assert.match(note, /éditions?/);
  assert.match(note, /±5 %|±25 %/, 'the frozen rule, or the €/m² below read as quantiles');

  const entries = dvfLegendEntries(reference, new Map([['at-median', 2], ['low', 1]]));
  // NOT in the key. A row with an empty swatch and a six-line paragraph is
  // what pushed the colours off the bottom of the rail.
  assert.ok(entries.every((entry) => entry.color), 'every entry of the key is painted');
  assert.ok(!entries.some((entry) => /médian de/i.test(entry.label)));
  // Every ramp class states its bounds in €/m², which is the only form of the
  // bound a reader can compare to a listing (D2).
  const atMedian = entries.find((entry) => entry.color === '#ffe066');
  assert.match(atMedian.label, /8\D?508/);
  assert.match(atMedian.label, /9\D?404/);
  assert.equal(atMedian.count, 2);
  // The ratio that DEFINES the class is not lost, it is in the tooltip.
  assert.match(atMedian.blurb, /−5 à \+5 %/);
  // Every entry carries a count: the panel prints one whether or not it is
  // supplied, and an absent one renders "undefined".
  for (const entry of entries) assert.equal(typeof entry.count, 'number');
});

test('the legend hands every count to the theme rather than inventing them', () => {
  const reference = dvfReference(payloadFor(AVENUE_DE_FRANCE, 300));
  const forTheme = dvfLegendEntries(reference);
  // Swatches carry no count so `resolveBuildingThemePaint` can fill them with
  // VOLUMES. Every entry is a swatch now, so every entry is countable that
  // way — which is exactly why the reference line had to stop being one.
  for (const entry of forTheme) {
    assert.equal(entry.count, undefined, `${entry.label} must be counted by the theme`);
  }
});

test('the theme carries the denominator with the swatches it lends out', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  assert.equal(_dvfSetThemePayloadForTest(payload), true);
  const theme = getActiveBuildingTheme();
  // Bâti 3D prints these swatches on ITS row and cannot reconstruct what they
  // are divided by. A ramp of ratios with no reference territory beside it is
  // unreadable there in exactly the way it would be here.
  assert.match(theme.legendNote, /Paris 13e Arrondissement/);
  assert.match(theme.legendNote, /8\D?956/);
  clearAllBuildingThemes();
});

test('an absent reference block says so instead of borrowing the local median', () => {
  const legacy = { commune: { code: '75113', name: 'Paris' }, years: [2024], sales: [], summary: { medianPrixM2: 8857 } };
  const reference = dvfReference(legacy);
  assert.equal(reference.basis, 'absent');
  assert.equal(reference.medianPrixM2, null);
  assert.notEqual(reference.medianPrixM2, 8857);
  assert.match(reference.label, /indisponible/);
});

test('the editions the denominator covers are named', () => {
  assert.equal(dvfYearsLabel([2024]), 'édition 2024');
  assert.equal(dvfYearsLabel([2024, 2023, 2022]), 'éditions 2022 à 2024');
  assert.equal(dvfYearsLabel([2024, 2021]), 'éditions 2021, 2024');
  assert.equal(dvfYearsLabel([]), null);
});

/* ── A5: what was clipped, what could not be placed ──────────────────────── */

test('the row declares the clipped count and the mutations with no coordinate', () => {
  const payload = payloadFor(AVENUE_DE_FRANCE, 1000);
  const controls = dvfSalesLayer.getRowControls?.call(null);
  // The FILTER is published before the first scan — a control a reader cannot
  // find until the layer has answered is a control they will not find. The KEY
  // is not: a key to a wash that is not on screen describes nothing.
  assert.deepEqual(controls?.legend, undefined, 'no key while the layer has never scanned');
  assert.equal(controls.chips.length, 3);
  assert.ok(controls.chips.find((chip) => chip.id === 'type:tous').active);

  // The fixture holds exactly one mutation the register publishes without a
  // coordinate — it has a price (10 464 €/m²) and cannot be drawn.
  const reference = dvfReference(payload);
  assert.equal(reference.unplacedCount, 1);
  const entries = dvfLegendEntries(reference, new Map());
  assert.equal(entries.some((entry) => /sans coordonnée/.test(entry.label)), false,
    'the unplaced line is not a class of the ramp');

  // It is one sentence under the classes — the A5 slot — and it holds all
  // three admissions at once: the reach of the scan, what was clipped, and
  // what the register publishes with no position at all.
  const disclosure = dvfLegendDisclosure(reference, payload.summary, payload.sales.length);
  assert.match(disclosure, /300 m/, 'the reach of the scan, which is not a fact about the market');
  assert.match(disclosure, /sans coordonnée/);
  assert.match(disclosure, /\b1\b/, 'the count itself');
  // One line, not three paragraphs: this is what replaced a key that ran off
  // the bottom of the rail before its first colour.
  assert.ok(disclosure.length < 260, `disclosure is ${disclosure.length} characters`);

  // A clipped answer says so, with both numbers.
  const clipped = dvfLegendDisclosure(reference, { truncated: true, count: 412 }, 400);
  assert.match(clipped, /écrêté à 400 sur 412/);
  assert.doesNotMatch(dvfLegendDisclosure(reference, { truncated: false, count: 40 }, 40), /écrêté/);
});

/* ── the filter, and the plots under the markers ─────────────────────────── */

test('the type chips filter the map, which is what a reader thought they did', () => {
  const sales = [
    { id: 'a', types: ['Appartement'], parcelle: 'P1', date: '2024-01-01' },
    { id: 'b', types: ['Appartement', 'Dépendance'], parcelle: 'P1', date: '2025-01-01' },
    { id: 'c', types: ['Maison'], parcelle: 'P2', date: '2023-01-01' },
    { id: 'd', types: ['Local industriel. commercial ou assimilé'], parcelle: 'P3', date: '2022-01-01' },
    { id: 'e', types: [], parcelle: 'P4', date: '2021-01-01' },
  ];
  assert.equal(filterSalesByType(sales, 'tous').length, 5);
  // A flat sold with its cellar is a flat; a commercial local is not, and
  // neither is a mutation the register published with no `type_local`.
  assert.deepEqual(filterSalesByType(sales, 'Appartement').map((sale) => sale.id), ['a', 'b']);
  assert.deepEqual(filterSalesByType(sales, 'Maison').map((sale) => sale.id), ['c']);
  // An unknown value shows everything rather than emptying the map: a stale
  // share link must not look like a street where nothing ever sold.
  assert.equal(filterSalesByType(sales, 'bureau').length, 5);
  assert.equal(filterSalesByType(null, 'Maison').length, 0);

  // THE VOCABULARY IS THE ESTIMATE'S. That is what lets one chip steer both
  // members of the fused row through the manager's fan-out; two spellings of
  // `Maison` would silently split the row back into two populations.
  assert.deepEqual(
    DVF_TYPE_FILTERS.map((entry) => entry.id).filter((id) => id !== 'tous'),
    ['Appartement', 'Maison'],
  );
  // And it is a DRAW-ONLY parameter: the proxy is never asked a different
  // question, so the query string must not carry it.
  assert.equal(dvfSalesLayer.acceptsParams({ type: 'Maison' }), true);
  assert.equal(dvfSalesLayer.acceptsParams({ type: 'appartement' }), false);
});

test('a sale says what it bought, on its own card', () => {
  // 257 flats read as houses because no card, marker or key ever named a type.
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  const reference = dvfReference(payload);
  assert.ok(payload.sales.length > 0);
  for (const sale of payload.sales) {
    const card = dvfSaleCard(sale, reference);
    assert.ok(/Appartement|Maison|Dépendance|Local|Terrain|type non publié/.test(card), card);
  }
  // The register's own wording, joined rather than folded: a flat sold with a
  // shop is why that sale has no €/m², and the card has to let a reader see it.
  const mixed = dvfSaleCard(
    { types: ['Appartement', 'Local industriel. commercial ou assimilé'], valeur: 300000 },
    reference,
  );
  assert.match(mixed, /Appartement \+ Local/);
  assert.match(mixed, /pas de €\/m² comparable/);
  assert.match(dvfSaleCard({ types: [], valeur: 1 }, reference), /type non publié/);
});

test('the plot a sale bought is washed under it, in the price it sold at', () => {
  const reference = dvfReference(payloadFor(AVENUE_DE_FRANCE, 300));
  const parcels = [
    { id: 'P1', parts: [[[[2.37, 48.82], [2.371, 48.82], [2.371, 48.821], [2.37, 48.821], [2.37, 48.82]]]] },
    // A plot whose only sale is filtered out, and one the register never named.
    { id: 'P2', parts: [[[[2.38, 48.82], [2.381, 48.82], [2.381, 48.821], [2.38, 48.821], [2.38, 48.82]]]] },
  ];
  const sales = [
    { id: 'old', parcelle: 'P1', date: '2021-06-01', prixM2: 12406, valeur: 500000 },
    { id: 'new', parcelle: 'P1', date: '2024-06-01', prixM2: 6797, valeur: 300000 },
  ];
  const entities = [];
  const drawn = drawDvfParcels(
    { entities: { add: (entity) => entities.push(entity) } },
    parcels, sales, reference, 2,
  );
  assert.equal(drawn, 1, 'a plot with nothing left to click is not washed');
  const fill = entities.find((entity) => entity.polygon);
  assert.ok(fill, 'the plot is a classified polygon');
  assert.equal(fill.polygon.classificationType, 2, 'clamped onto whatever the globe is drawing');
  assert.equal(fill.polygon.outline, false, 'a classified polygon cannot stroke itself');
  assert.ok(entities.some((entity) => entity.polyline?.clampToGround === true),
    'so the boundary is a separate clamped polyline');
  // THE MOST RECENT MUTATION, never a blend: 2024 at 6 797 €/m² is green
  // against this reference, 2021 at 12 406 is red, and a plot that showed the
  // older one would be publishing a price that is no longer the comparable.
  const expected = Cesium.Color.fromCssColorString(saleColorCss(6797, reference.medianPrixM2));
  assert.equal(fill.polygon.material.red.toFixed(3), expected.red.toFixed(3));
  assert.equal(fill.polygon.material.green.toFixed(3), expected.green.toFixed(3));
  assert.match(fill.description, /parcelle P1/);
  assert.match(fill.description, /2024-06-01/);

  // An answer that carries no plots draws none, and says why on the A5 line.
  assert.equal(drawDvfParcels({ entities: { add: () => {} } }, [], sales, reference, 2), 0);
  assert.match(dvfLegendDisclosure(reference, {}, 12, { parcels: [] }), /Parcelles indisponibles/);
  assert.doesNotMatch(dvfLegendDisclosure(reference, {}, 12, {}), /Parcelles indisponibles/);
});

/* ── the building theme ──────────────────────────────────────────────────── */

test('the theme registers at precedence 20 and withdraws when the layer stops', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  assert.equal(_dvfSetThemePayloadForTest(payload), true);
  const theme = getActiveBuildingTheme();
  assert.equal(theme.id, DVF_LAYER_ID);
  assert.equal(theme.precedence, DVF_THEME_PRECEDENCE);
  assert.equal(theme.points.length, payload.sales.length);
  // Scope, not a verdict on the market: the scan covers 300 m, the volumes
  // cover kilometres, so an unpainted volume is usually one nobody asked about.
  assert.equal(theme.unknownLabel, 'hors du rayon de 300 m ou sans mutation');
  assert.doesNotMatch(theme.unknownLabel, /^sans mutation/);

  // A theme with a lower precedence takes the volumes; DVF does not blend in.
  registerBuildingTheme({
    id: 'dpe-fr', label: 'DPE', precedence: 10, points: [], reduce: () => null, colorFor: () => null,
  });
  assert.equal(getActiveBuildingTheme().id, 'dpe-fr');

  // Switching the layer off hands the volumes back rather than leaving the city
  // painted by a layer nobody can see.
  assert.equal(_dvfSetThemePayloadForTest(null, false), false);
  assert.equal(getActiveBuildingTheme().id, 'dpe-fr');
  clearAllBuildingThemes();
});

test('a volume speaks for its most recent mutation, whatever that mutation says', () => {
  const older = { id: 'a', date: '2022-03-01', prixM2: 12000, dwellingSurface: 40 };
  const newer = { id: 'b', date: '2024-07-15', prixM2: 8000, dwellingSurface: 55 };
  assert.equal(dvfMostRecentSale([older, newer]).id, 'b');
  assert.equal(dvfMostRecentSale([newer, older]).id, 'b', 'order of arrival must not decide');

  // A median of the two would publish 10 000 €/m² — a price nobody paid, at a
  // date that does not exist.
  const median = percentile([8000, 12000], 0.5);
  assert.equal(median, 10000);
  assert.notEqual(dvfMostRecentSale([older, newer]).prixM2, median);

  // And the most recent one wins even when it cannot be priced: falling back to
  // the older comparable would present a 2022 price as today's.
  const blockSale = { id: 'c', date: '2024-11-02', prixM2: null, dwellingSurface: 0 };
  assert.equal(dvfMostRecentSale([older, blockSale]).id, 'c');
  assert.equal(saleColorCss(saleRatioPrice(dvfMostRecentSale([older, blockSale])), 8956),
    COLOR_NO_RATIO);
});

test('ties are broken by surface then by id, never by concatenation order', () => {
  const small = { id: 'z', date: '2024-05-05', prixM2: 9000, dwellingSurface: 30 };
  const large = { id: 'a', date: '2024-05-05', prixM2: 7000, dwellingSurface: 90 };
  assert.equal(dvfMostRecentSale([small, large]).id, 'a');
  assert.equal(dvfMostRecentSale([large, small]).id, 'a');
  const twinA = { id: 'a', date: '2024-05-05', prixM2: 9000, dwellingSurface: 30 };
  const twinB = { id: 'b', date: '2024-05-05', prixM2: 7000, dwellingSurface: 30 };
  assert.equal(dvfMostRecentSale([twinA, twinB]).id, 'b');
  assert.equal(dvfMostRecentSale([twinB, twinA]).id, 'b');
});

test('the volumes and the markers are painted the same colour by the same rule', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  _dvfSetThemePayloadForTest(payload);
  const theme = getActiveBuildingTheme();
  // Three sales at the same address in the fixture: one volume, the most recent
  // of the three, and the marker of that sale carries the same hex.
  const footprint = {
    id: 'BAT-1',
    degrees: [2.3750, 48.8298, 2.3752, 48.8298, 2.3752, 48.8302, 2.3750, 48.8302],
    holes: [],
  };
  const paint = resolveBuildingThemePaint([footprint], theme);
  assert.equal(paint.matchedPoints, 3);
  assert.equal(paint.painted, 1);
  const winner = dvfMostRecentSale(payload.sales.filter((sale) => sale.lon === 2.375086));
  const expected = saleColorCss(saleRatioPrice(winner), dvfReference(payload).medianPrixM2);
  assert.equal(paint.colorById.get('BAT-1'), expected);
  // The theme's legend was counted against what was actually painted.
  const painted = paint.legend.find((entry) => entry.color === expected);
  assert.equal(painted.count, 1);
  clearAllBuildingThemes();
});

test('a sale on no loaded footprint is counted, not swallowed (A5)', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 1000);
  _dvfSetThemePayloadForTest(payload);
  const elsewhere = {
    id: 'BAT-9',
    degrees: [2.0, 48.0, 2.0001, 48.0, 2.0001, 48.0001, 2.0, 48.0001],
    holes: [],
  };
  const paint = resolveBuildingThemePaint([elsewhere], getActiveBuildingTheme());
  assert.equal(paint.painted, 0);
  assert.equal(paint.unmatchedPoints, payload.sales.length);
  assert.equal(paint.unplacedPoints, 0, 'the feed already drops coordinate-less mutations');
  clearAllBuildingThemes();
});

test('flying above the scan ceiling hands the volumes back', () => {
  // The shell clears its draw without calling `render` when the camera goes
  // dormant, so the theme has to be retracted from the one method that still
  // runs. Without this the volumes of the NEXT city would be told, in a
  // legend, that no sale was ever recorded there.
  clearAllBuildingThemes();
  _dvfSetThemePayloadForTest(payloadFor(AVENUE_DE_FRANCE, 300));
  assert.equal(getActiveBuildingTheme()?.id, DVF_LAYER_ID);
  _dvfWithdrawIfDormantForTest({ dormant: false });
  assert.equal(getActiveBuildingTheme()?.id, DVF_LAYER_ID, 'a live scan keeps painting');
  _dvfWithdrawIfDormantForTest({ dormant: true });
  assert.equal(getActiveBuildingTheme(), null);
  // Idempotent: a panel polling `getStats()` must not thrash the registry.
  _dvfWithdrawIfDormantForTest({ dormant: true });
  assert.equal(getActiveBuildingTheme(), null);
  clearAllBuildingThemes();
});

test('the wrapper keeps the shell contract the manager relies on', () => {
  // `manager.js` reads `enable()`/`disable()` as "anything but false means it
  // worked", and reads id/name/updateInterval off the module.
  assert.equal(dvfSalesLayer.id, DVF_LAYER_ID);
  assert.equal(dvfSalesLayer.name, 'Prix de l’immobilier (DVF)');
  assert.equal(typeof dvfSalesLayer.updateInterval, 'number');
  for (const method of ['init', 'enable', 'disable', 'destroy', 'update', 'getStats', 'getRowControls']) {
    assert.equal(typeof dvfSalesLayer[method], 'function', method);
  }
  // `disable()` itself needs a DOM (the shell removes a click handler), so the
  // theme half of it is exercised through the seam above; what is checked here
  // is that the wrapper did not shadow a method away.
  assert.equal(typeof dvfSalesLayer.getStats().count, 'number');
  assert.equal(dvfSalesLayer.getStats().dormant, false);
});

// ── WHAT THE VOICE SURFACE MAY SAY ─────────────────────────────────────────
// The gap this closes: asked for the average price around a Bordeaux bike
// station, the assistant answered that it had no access to that analysis while
// the proxy had already computed the median and the card was printing it.

test('a sale becomes a record the analyst engine can query', () => {
  const sale = {
    id: '2024-123', lat: 44.8446, lon: -0.5786, prixM2: 5508, valeur: 330_480,
    dwellingSurface: 60, dwellingCount: 1, rooms: 3, distanceM: 84,
    date: '2024-06-12', nature: 'Vente', types: ['Appartement'],
    address: '12 place des Grands Hommes', commune: 'Bordeaux',
  };
  const record = dvfSaleRecord(sale);
  assert.equal(record.id, 'dvf:2024-123');
  assert.equal(record.prixM2, 5508);
  assert.equal(record.valeurEur, 330_480);
  assert.equal(record.surfaceM2, 60);
  assert.equal(record.year, 2024);
  assert.equal(record.propertyType, 'Appartement');
  assert.equal(record.priced, true);
  // A sale with no position cannot be a neighbour of anything.
  assert.equal(dvfSaleRecord({ ...sale, lat: null }), null);
});

test('a mutation the register cannot price carries no price at all', () => {
  // The 179-lot block sale of the module header. `prixM2: null` is what keeps
  // €1.28 million per square metre out of every answer — the engine drops
  // non-finite values, so it can never reach a min, a max or a spoken figure,
  // while the sale still counts as a sale.
  const record = dvfSaleRecord({
    id: 'bloc', lat: 48.83, lon: 2.36, prixM2: null, valeur: 32_000_000,
    dwellingSurface: 0, dwellingCount: 179, date: '2023-02-01', nature: 'Vente',
  });
  assert.equal(record.prixM2, null);
  assert.equal(record.priced, false);
  assert.equal(record.surfaceM2, null);
  assert.equal(record.valeurEur, 32_000_000);
});

test('the voice summary is the layer\'s own figures, and is silent when dormant', () => {
  const stats = {
    count: 255, dormant: false, commune: 'Bordeaux', years: [2025, 2024, 2023],
    salesFound: 302, comparableCount: 96, truncated: true,
    localMedianPrixM2: 5508, p25PrixM2: 4700, p75PrixM2: 6400,
    referenceMedianPrixM2: 5100, referenceLabel: 'Médian de Bordeaux',
  };
  const summary = dvfVoiceSummary(stats);
  assert.equal(summary.blockMedianPrixM2, 5508);
  assert.equal(summary.communeMedianPrixM2, 5100);
  assert.equal(summary.communeReference, 'Médian de Bordeaux');
  // The denominator of the median travels with it: 255 sales of which 96 can
  // carry a price is not 255 prices.
  assert.equal(summary.salesInRadius, 302);
  assert.equal(summary.pricedSales, 96);
  assert.equal(summary.radiusM, 300);
  // Above the scan ceiling the layer has nothing to speak for, and "no median"
  // is a different statement from "a median of nothing".
  assert.equal(dvfVoiceSummary({ ...stats, dormant: true }), null);
  assert.equal(dvfVoiceSummary(null), null);

  // Switched on a second ago and still scanning. Silence here reads as "this
  // place has no sales", which is what a live session actually said.
  const pending = dvfVoiceSummary({ count: 0, dormant: false, lastUpdate: null });
  assert.equal(pending.pending, true);
  assert.equal(pending.blockMedianPrixM2, undefined);
  assert.match(pending.note, /NOT "no sales here"/);
});

test('the summary says WHERE it was measured, so a stale block cannot be quoted', () => {
  // The scan does not clear on arrival: fly Paris → Bordeaux and the layer
  // holds the Paris block until the next answer lands. Without a position on
  // the summary, a caller has no way to know which city it is reading.
  const summary = dvfVoiceSummary({
    count: 12, dormant: false, commune: 'Paris', salesFound: 302, comparableCount: 96,
    localMedianPrixM2: 12_264, scanCentre: { lat: 48.865, lon: 2.284 },
  });
  assert.deepEqual(summary.measuredAt, { lat: 48.865, lon: 2.284 });
  // A layer that has drawn without recording a centre says null rather than
  // implying it was measured where the camera happens to be now.
  assert.equal(dvfVoiceSummary({ count: 0, dormant: false, salesFound: 0 }).measuredAt, null);
});

test('the wrapper publishes the three voice hooks', () => {
  for (const method of ['getAnalystRecords', 'getSelectedInfo', 'getVoiceSummary']) {
    assert.equal(typeof dvfSalesLayer[method], 'function', method);
  }
  // Nothing drawn, nothing to hand over — never a stale block from a city the
  // reader has already flown away from.
  _dvfSetThemePayloadForTest(null, false);
  assert.deepEqual(dvfSalesLayer.getAnalystRecords(), []);
  assert.equal(dvfSalesLayer.getSelectedInfo(), null);
  assert.equal(dvfSalesLayer.getVoiceSummary(), null);
});

test('the drawn payload is what answers, capped like every other layer', () => {
  const sales = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`, lat: 44.84 + i / 1000, lon: -0.578, prixM2: 5000 + i,
    valeur: 300_000, dwellingSurface: 60, dwellingCount: 1, date: '2024-01-01',
    nature: 'Vente', types: ['Appartement'], commune: 'Bordeaux',
  }));
  _dvfSetThemePayloadForTest({ sales, summary: {}, commune: { name: 'Bordeaux' } });
  assert.equal(dvfSalesLayer.getAnalystRecords().length, 5);
  assert.equal(dvfSalesLayer.getAnalystRecords(2).length, 2);
  assert.equal(dvfSalesLayer.getAnalystRecords()[0].id, 'dvf:s0');
  _dvfSetThemePayloadForTest(null, false);
  clearAllBuildingThemes();
});

// ── the cell regime ────────────────────────────────────────────────────────
test('a cell is coloured by the same frozen ramp as a sale', () => {
  // The whole argument for changing the UNIT and not the language: a reader
  // who learned the ramp at street level reads the same ramp from altitude.
  assert.equal(dvfCellClass(1.4).id, 'very-high');
  assert.equal(dvfCellClass(1.1).id, 'high');
  assert.equal(dvfCellClass(1).id, 'at-median');
  assert.equal(dvfCellClass(0.8).id, 'low');
  assert.equal(dvfCellClass(0.4).id, 'very-low');
  for (const klass of DVF_RATIO_CLASSES) {
    assert.equal(dvfCellClass(klass.min === -Infinity ? 0.01 : klass.min).id, klass.id);
  }
});

test('a cell the register could not price takes the neutral, never a band', () => {
  assert.equal(dvfCellClass(null), null);
  assert.equal(dvfCellClass(0), null);
  assert.equal(dvfCellColorCss({ medianRatio: null }), COLOR_NO_RATIO);
  assert.equal(dvfCellColorCss({ medianRatio: 1 }), DVF_RATIO_CLASSES[2].color);
});

test('the key in cell mode labels the RATIOS, because there is no single median', () => {
  // Two communes, two denominators — so restating the breaks in €/m² would
  // have to pick one of them and would be false for the other.
  const payload = {
    years: [2025, 2024, 2023],
    cells: [],
    summary: {
      references: [
        { code: '69386', name: 'Lyon 6e', medianPrixM2: 5_500, count: 2_661, comparableCount: 1_808 },
        { code: '69383', name: 'Lyon 3e', medianPrixM2: 4_660, count: 5_417, comparableCount: 3_500 },
      ],
    },
  };
  const reference = dvfCellReference(payload);
  assert.equal(reference.medianPrixM2, null);
  assert.equal(reference.basis, 'communes');
  const entries = dvfLegendEntries(reference, new Map());
  assert.equal(entries[0].label, '+25 % et plus');
  // And every denominator is named rather than counted.
  const note = dvfCellLegendNote(payload);
  assert.match(note, /Lyon 6e/);
  assert.match(note, /Lyon 3e/);
  assert.match(note, /5\s500/u);
  assert.match(note, /4\s660/u);
  assert.match(note, /taille du disque/);
});

test('the cell key counts CELLS, and the neutral has its own bucket', () => {
  const counts = countCellsByClass([
    { medianRatio: 1.4 }, { medianRatio: 1.4 }, { medianRatio: 1 }, { medianRatio: null },
  ]);
  assert.equal(counts.get('very-high'), 2);
  assert.equal(counts.get('at-median'), 1);
  assert.equal(counts.get('no-ratio'), 1);
});

test('the A5 line names the box, the grid and what the probe can miss', () => {
  const note = dvfCellDisclosure({
    box: { south: 45.77, west: 4.84, north: 45.79, east: 4.86 },
    communes: [{ code: '69386', name: 'Lyon 6e' }, { code: '69383', name: 'Lyon 3e' }],
    communesProbed: 9,
    unavailableYears: [2025],
    summary: { cellM: 150, count: 1_324, pricedCount: 901 },
  });
  assert.match(note, /2,2 km/);
  assert.match(note, /cellules de 150 m/);
  // `toLocaleString('fr-FR')` groups with a NARROW NO-BREAK SPACE, not a space.
  assert.match(note, /1\s324\sventes/u);
  assert.match(note, /sondage/);
  assert.match(note, /2025/);
  assert.match(note, /descendre sous 600 m/);
});

test('the voice surface never claims a radius it did not use', () => {
  // The failure this guards: a box answer published with `radiusM: 300` beside
  // it, and a caller saying "sur les 300 m autour de vous" about two kilometres.
  const cells = dvfVoiceSummary({
    dormant: false,
    scanBasis: 'cells',
    salesFound: 1_324,
    comparableCount: 901,
    cellSizeM: 150,
    localMedianPrixM2: 5_458,
    scanCentre: { lat: 45.777, lon: 4.8498 },
    communes: ['Lyon 6e', 'Lyon 3e'],
  });
  assert.equal(cells.basis, 'cells');
  assert.equal(cells.radiusM, undefined);
  assert.equal(cells.salesInView, 1_324);
  // And it says out loud that there is no per-sale list up here, because
  // `getAnalystRecords` returns none and an empty list reads as "no sales".
  assert.match(cells.note, /not by\s+sale|by AREA/);
  assert.match(cells.note, /600 m/);
});

test('the disc regime still answers with its radius', () => {
  const disc = dvfVoiceSummary({ dormant: false, salesFound: 102, count: 102 });
  assert.equal(disc.radiusM, 300);
  assert.equal(disc.basis, undefined);
});
