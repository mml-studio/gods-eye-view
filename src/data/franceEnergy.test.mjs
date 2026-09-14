// src/data/franceEnergy.test.mjs
// Covers the éCO2mix LAYER: the région → département grouping, the inverted
// sign convention that decides which way a prism is coloured, the frozen
// height domain, the three marks A1 requires (prism / flat zero / striped
// absence), Corsica's permanent exclusion, the border-arc direction, and the
// lifecycle. The upstream dataset shape is pinned separately in
// eco2mixFeed.test.mjs, and the prism grammar itself in choroplethPrism.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  BALANCE_DEADBAND_MW,
  BALANCE_STYLES,
  BORDER_ANCHORS,
  ENERGY_OVERLAY_COHORT_LIMIT,
  ENERGY_OVERLAY_COLLISION_CAPACITY,
  ENERGY_PRISM_DOMAIN_MAX_MW,
  ENERGY_PRISM_SCALE,
  REGION_DEPARTEMENTS,
  REGION_NAMES,
  UNCOVERED_REGIONS,
  borderArrowGlyph,
  borderArrowRotation,
  borderArrowCourseDeg,
  balanceStyle,
  borderLabelText,
  PRISM_FOOTPRINT_SCALE,
  buildBorderArcs,
  buildMarketOutlines,
  buildRegionRecords,
  buildRegionShapes,
  createFranceEnergyLayer,
  departementRegionIndex,
  energyClassificationTypeForStack,
  energyPrismLegend,
  energyPrismRow,
  formatMegawatts,
  frontierAnchors,
  mapAnalystRecord,
  marketOutlineStyles,
  regionAnchor,
  regionLabelHeightM,
  regionLabelText,
  selectEnergyOverlayCohort,
  summarizeNational,
  unmeasuredRegions,
} from './franceEnergy.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { ringArea } from './polygonDissolve.js';
import { greatCircleDistanceM } from './greatCircleArc.js';
import { MAKI_PATHS } from './mapIcons.js';

/** Ray casting, so a test can say "this point is inside that country". */
function pointInRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
import {
  PRISM_BODY_ALPHA,
  PRISM_MAX_HEIGHT_M,
  PRISM_MIN_HEIGHT_M,
  PRISM_NO_RATIO_COLOR,
  PRISM_TOP_ALPHA,
  prismApparentPx,
} from './choroplethPrism.js';
import { projectEco2mix } from './eco2mixFeed.js';

const BUNDLED = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const MARKET_AREAS = JSON.parse(readFileSync(
  new URL('./local_data/energy_market_areas/market_areas.geojson', import.meta.url),
  'utf8',
));
const PAYLOAD = projectEco2mix({
  national: JSON.parse(readFileSync(
    new URL('./fixtures/eco2mix-national-tr-sample.json', import.meta.url), 'utf8',
  )),
  regional: JSON.parse(readFileSync(
    new URL('./fixtures/eco2mix-regional-tr-sample.json', import.meta.url), 'utf8',
  )),
}, 'test');

// ── The grouping ────────────────────────────────────────────────────────────

test('the région grouping covers the 96 bundled départements exactly once', () => {
  // If this drifts, some département is painted by two régions or by none —
  // and "by none" is a silent hole, not a visible error.
  const grouped = Object.values(REGION_DEPARTEMENTS).flat();
  assert.equal(grouped.length, new Set(grouped).size, 'a département is listed twice');
  const bundled = BUNDLED.features.map((feature) => feature.properties.code).sort();
  assert.deepEqual(grouped.slice().sort(), bundled);
  assert.equal(bundled.length, 96);
});

test('the index resolves Corsica to a région that is declared uncovered', () => {
  const index = departementRegionIndex();
  assert.equal(index.size, 96);
  assert.equal(index.get('75'), '11');
  assert.equal(index.get('69'), '84');
  // Known, not missing — the distinction the header insists on.
  assert.equal(index.get('2A'), '94');
  assert.ok(UNCOVERED_REGIONS.includes('94'));
});

test('the 12 régions upstream are exactly the covered ones', () => {
  const covered = Object.keys(REGION_DEPARTEMENTS)
    .filter((code) => !UNCOVERED_REGIONS.includes(code)).sort();
  const upstream = PAYLOAD.regions.map((region) => region.code).sort();
  assert.deepEqual(upstream, covered);
});

// ── The sign convention ─────────────────────────────────────────────────────

test('POSITIVE netPhysical is an IMPORTER — the inverted convention', () => {
  // Upstream publishes consumption minus generation, so a positive number is a
  // deficit. Getting this backwards would colour the entire map wrong while
  // still looking plausible, which is why it is pinned here.
  assert.equal(balanceStyle(6478, 6851).style.key, 'importer');
  assert.equal(balanceStyle(-7781, 6448).style.key, 'exporter');
  assert.equal(BALANCE_STYLES.importer.verb, 'IMPORTE');
  assert.equal(BALANCE_STYLES.exporter.verb, 'EXPORTE');
});

test('the deadband stops claiming a DIRECTION, not a measurement', () => {
  // The old contract returned null inside the deadband, which put "éCO2mix
  // published nothing" and "éCO2mix published zero" behind one absence — A1,
  // and far more dangerous now that absence means "no prism at all".
  assert.equal(balanceStyle(0, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(BALANCE_DEADBAND_MW - 0.001, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(-BALANCE_DEADBAND_MW + 0.001, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(BALANCE_DEADBAND_MW, 5000).style.key, 'importer');
  assert.equal(balanceStyle(-BALANCE_DEADBAND_MW, 5000).style.key, 'exporter');
  // Null now means UNMEASURED and nothing else.
  assert.equal(balanceStyle(null, 5000), null);
  assert.equal(balanceStyle(undefined, 5000), null);
  assert.equal(balanceStyle(Number.NaN, 5000), null);
});

test('the ratio the fill alpha used to carry survives as a number', () => {
  // A3: alpha ramped 0.12 → 0.52 on |balance| / load. It carries nothing now,
  // but the variable is not lost — it travels to the analyst record.
  const large = balanceStyle(-7781, 6448);
  assert.ok(large.ratio > 1.2 && large.ratio < 1.25);
  assert.equal(large.alpha, undefined, 'alpha is not a channel any more');
  // A missing load must not produce NaN.
  assert.equal(balanceStyle(-500, null).ratio, 0);
  assert.equal(balanceStyle(-500, 0).ratio, 0);
});

// ── The prism ───────────────────────────────────────────────────────────────

test('the height domain is a frozen literal, and it is not the sample', () => {
  // C1. The largest balance ever measured here is 7 781 MW; the domain is
  // 12 000, deliberately above the fleet's plausible maximum, so a cold day
  // does not silently rescale the country.
  assert.equal(ENERGY_PRISM_SCALE.domainMax, ENERGY_PRISM_DOMAIN_MAX_MW);
  assert.equal(ENERGY_PRISM_DOMAIN_MAX_MW, 12_000);
  assert.equal(ENERGY_PRISM_SCALE.domainMin, 0);
  assert.equal(ENERGY_PRISM_SCALE.maxHeightM, PRISM_MAX_HEIGHT_M);
  const observed = Math.max(...PAYLOAD.regions.map((r) => Math.abs(r.netPhysical)));
  assert.ok(observed < ENERGY_PRISM_DOMAIN_MAX_MW, `observed max ${observed}`);
  assert.ok(Object.isFrozen(ENERGY_PRISM_SCALE));
});

test('the scale is LINEAR, and the measurement that justifies it', () => {
  // choroplethPrism only licenses 'sqrt' above a dynamic range of ~1:30, where
  // the floor starts doing the work. This layer runs 7 781 → 1 544 MW.
  const magnitudes = PAYLOAD.regions.map((r) => Math.abs(r.netPhysical));
  const range = Math.max(...magnitudes) / Math.min(...magnitudes);
  assert.equal(ENERGY_PRISM_SCALE.mode, 'linear');
  assert.ok(range < 30, `dynamic range ${range.toFixed(1)} would need declaring`);
  // And nothing is floored: the smallest région stands well clear of 4 km.
  const shortest = Math.min(...PAYLOAD.regions.map(
    (r) => energyPrismRow(r).heightM,
  ));
  assert.ok(shortest > PRISM_MIN_HEIGHT_M * 3, `${shortest} m is nearly the floor`);
});

test('height is |MW| and colour is the SIGN — the two channels never swap', () => {
  const aura = energyPrismRow({ code: '84', netPhysical: -7781 });
  const idf = energyPrismRow({ code: '11', netPhysical: 6478 });
  // Same ruler for both directions: 7 781 MW of export is taller than 6 478 MW
  // of import, which is the one comparison the flat fill could never make.
  assert.ok(aura.heightM > idf.heightM);
  assert.equal(Math.round(aura.heightM), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
  assert.equal(aura.color, BALANCE_STYLES.exporter.color);
  assert.equal(idf.color, BALANCE_STYLES.importer.color);
  // Equal magnitudes, opposite signs: same height, different colour. That is
  // the whole arbitration, in one assertion.
  const up = energyPrismRow({ code: 'a', netPhysical: 4000 });
  const down = energyPrismRow({ code: 'b', netPhysical: -4000 });
  assert.equal(up.heightM, down.heightM);
  assert.notEqual(up.color, down.color);
  assert.ok(up.heightM > 0, 'and neither of them goes below the datum');
});

test('an unmeasured balance is not a measured zero', () => {
  // `Math.abs(null)` is 0. Handing that to the scale would fabricate a
  // measured zero out of a région nobody published — the fault the whole
  // grammar exists to prevent.
  const missing = energyPrismRow({ code: '94', netPhysical: null });
  assert.equal(missing.heightM, null);
  assert.equal(missing.hasValue, false);
  assert.equal(missing.measuredZero, false);
  assert.equal(missing.color, null);

  const zero = energyPrismRow({ code: '11', netPhysical: 0 });
  assert.equal(zero.heightM, 0);
  assert.equal(zero.measuredZero, true);
  assert.equal(zero.extruded, false);
  assert.equal(zero.color, BALANCE_STYLES.balanced.color);

  for (const junk of [{}, { netPhysical: 'beaucoup' }, { netPhysical: [] }, { netPhysical: true }]) {
    assert.equal(energyPrismRow(junk).heightM, null, JSON.stringify(junk));
  }
});

test('a balance above the frozen domain is clipped, and says so', () => {
  // A5. 12 000 MW is above the fleet's plausible maximum, but a frozen domain
  // has a top by construction and the map has to admit when it hits it.
  const winter = energyPrismRow({ code: '84', netPhysical: -14_000 });
  assert.equal(winter.clipped, true);
  assert.equal(winter.heightM, PRISM_MAX_HEIGHT_M);
  assert.equal(energyPrismRow({ code: '84', netPhysical: -7781 }).clipped, false);
});

test('the calibration figures in the header are reproducible', () => {
  // The numbers the header quotes at the ~1 500 km national altitude. If the
  // domain or the max height moves, this fails and the header gets rewritten.
  const px = (mw) => prismApparentPx({
    heightM: energyPrismRow({ code: 'x', netPhysical: mw }).heightM,
    cameraDistanceM: 1_500_000,
  });
  assert.ok(Math.abs(px(-7781) - 74.9) < 0.2, `AURA ${px(-7781)}`);
  assert.ok(Math.abs(px(6478) - 62.3) < 0.2, `IDF ${px(6478)}`);
  assert.ok(Math.abs(px(1544) - 14.9) < 0.2, `Bretagne ${px(1544)}`);
  // The two leaders are 12 px apart on screen: a difference the eye sorts.
  assert.ok(px(-7781) - px(6478) > 10);
});

// ── The join ────────────────────────────────────────────────────────────────

test('buildRegionRecords whitelists on the grouping and drops Corsica', () => {
  const departements = parseDepartements(BUNDLED);
  const records = buildRegionRecords(PAYLOAD, departements);
  assert.equal(records.length, 12);
  const codes = records.map((record) => record.code);
  assert.ok(!codes.includes('94'));

  // A DOM région appearing upstream must not land on a metropolitan map.
  const withDom = buildRegionRecords({
    regions: [...PAYLOAD.regions, { code: '04', name: 'La Réunion', load: 400, netPhysical: 0 }],
  }, departements);
  assert.equal(withDom.length, 12);

  // Even if Corsica did appear upstream, it stays unpainted.
  const withCorse = buildRegionRecords({
    regions: [...PAYLOAD.regions, { code: '94', name: 'Corse', load: 300, netPhysical: -50 }],
  }, departements);
  assert.equal(withCorse.length, 12);
  assert.ok(!withCorse.some((record) => record.code === '94'));
});

test('records stay ordered weakest-first, deterministically', () => {
  // Translucent volumes are depth-sorted by the renderer, so this no longer
  // decides who paints over whom — it keeps the label cohort, the analyst
  // snapshot and the legend counts stable from one poll to the next.
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const magnitudes = records.map((record) => Math.abs(record.netPhysical));
  assert.deepEqual(magnitudes, magnitudes.slice().sort((a, b) => a - b));
  assert.equal(records.at(-1).code, '84', 'Auvergne-Rhône-Alpes had the largest balance');
});

test('every région carries its full département list', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const idf = records.find((record) => record.code === '11');
  assert.deepEqual(idf.departements.slice().sort(), REGION_DEPARTEMENTS[11].slice().sort());
  assert.equal(idf.departements.length, 8);
});

test('the région label anchor lands inside its own région', () => {
  const departements = parseDepartements(BUNDLED);
  // Île-de-France is the tightest test: a mean that drifted would leave the
  // capital's label sitting in a neighbouring région.
  const idf = regionAnchor(REGION_DEPARTEMENTS[11], departements);
  assert.ok(idf[0] > 1.6 && idf[0] < 3.2, `IDF anchor lon ${idf[0]}`);
  assert.ok(idf[1] > 48.4 && idf[1] < 49.3, `IDF anchor lat ${idf[1]}`);
  // Bretagne sits well west; a swapped lon/lat would fail here loudly.
  const bretagne = regionAnchor(REGION_DEPARTEMENTS[53], departements);
  assert.ok(bretagne[0] < -1.5 && bretagne[1] > 47.5);
  assert.equal(regionAnchor(['zz'], departements), null);
  assert.equal(regionAnchor([], departements), null);
});

// ── The arcs ────────────────────────────────────────────────────────────────

test('the POINT lands where the power arrives, whichever way it flows', () => {
  // The tip is the mark that carries the sense, so this is the assertion that
  // stands for "the reader can see which way it goes".
  const [imported] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: 500 }]);
  assert.equal(imported.importing, true);
  assert.equal(imported.style.key, 'importer');
  // An import runs abroad → France, so the TIP is the inland end and the tail
  // is out on the bearing of the Spanish reference point.
  assert.ok(imported.tip[1] > imported.frontier[1], 'the tip lands inland');
  assert.ok(imported.tail[1] < imported.frontier[1], 'the flow comes from the south');

  const [exported] = buildBorderArcs([{ key: 'italie', label: 'Italie', mw: -2537 }]);
  assert.equal(exported.importing, false);
  assert.equal(exported.style.key, 'exporter');
  assert.ok(exported.tail[0] < exported.frontier[0], 'the tail starts inland');
  assert.ok(exported.tip[0] > exported.frontier[0], 'the flow heads east');

  for (const arc of [imported, exported]) {
    // The glyph STRADDLES its frontier: 190 km abroad, 110 km back into
    // France. Anything else and it is a mark that leaves a border rather than
    // one that crosses it.
    const abroad = arc.importing ? arc.tail : arc.tip;
    const inland = arc.importing ? arc.tip : arc.tail;
    assert.ok(Math.abs(greatCircleDistanceM(arc.frontier, abroad) - 190_000) < 2_000);
    assert.ok(Math.abs(greatCircleDistanceM(arc.frontier, inland) - 110_000) < 2_000);
    assert.ok(Math.abs(greatCircleDistanceM(arc.tail, arc.tip) - arc.lengthM) < 2_000);
    // A billboard is placed by its CENTRE, and the straddle is not symmetric,
    // so the centre is 40 km abroad of the frontier — not on it.
    assert.ok(Math.abs(greatCircleDistanceM(arc.tail, arc.anchor) - arc.lengthM / 2) < 2_000);
    assert.ok(Math.abs(greatCircleDistanceM(arc.anchor, arc.tip) - arc.lengthM / 2) < 2_000);
    // The label rides on the far end, out over the market, where this layer
    // draws nothing else. On the centre it would sit across the shaft.
    assert.deepEqual(arc.labelAt, abroad);
  }
});

test('the glyph is a READY-MADE arrow, and its length is not a variable', () => {
  // The artwork is Maki's, CC0, vendored verbatim — this file draws no arrow
  // of its own any more. Pinned here because a redraw upstream is a redraw of
  // the loudest mark on the map.
  assert.ok(MAKI_PATHS.arrow.startsWith('M8.29289 2.29289C8.68342 1.90237'));
  assert.ok(MAKI_PATHS.arrow.endsWith('C7.90237 3.31658 7.90237 2.68342 8.29289 2.29289Z'));

  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontierAnchors(BUNDLED));
  // Length is ONE constant now. The tube clamped it to [170, 340] km, which
  // still left a 2:1 ratio between Switzerland and Spain that the data never
  // wrote — geography the reader could see and could not use.
  const lengths = new Set(arcs.map((arc) => arc.lengthM));
  assert.equal(lengths.size, 1, [...lengths].join(','));
  assert.equal([...lengths][0], 300_000);
  for (const arc of arcs) {
    // Depth is the only channel, in METRES: the rest of the layer measures in
    // metres, and a hairline that never grows is what made this unreadable.
    assert.ok(arc.depthM >= 150_000 && arc.depthM <= 300_000, `${arc.key} ${arc.depthM}`);
    // Never TALLER than it is long: past that, Maki's arrow stops reading as
    // an arrow, which is the one distortion the anisotropic draw must not make.
    assert.ok(arc.depthM <= arc.lengthM, `${arc.key} ${arc.depthM} > ${arc.lengthM}`);
    // Flat, at one altitude that ramps with nothing — the sine bow is gone.
    // ABOVE the tallest prism this layer can draw, which is a Z-ORDER and not
    // a height: at 30 km the mark was hidden under a 0.95-opaque prism top.
    assert.equal(arc.altitudeM, PRISM_MAX_HEIGHT_M + 10_000);
    assert.ok(arc.altitudeM > PRISM_MAX_HEIGHT_M);
  }
});

test('the arrow wears the PRISM\'s transparency, not the icon packs\' halo', () => {
  const svg = Buffer.from(borderArrowGlyph(320).split(',')[1], 'base64').toString('utf8');
  // The two alphas are the prism's own, imported rather than retyped, so the
  // three marks of this layer cannot drift apart.
  assert.match(svg, new RegExp(`fill-opacity="${PRISM_BODY_ALPHA}"`));
  assert.match(svg, new RegExp(`stroke-opacity="${PRISM_TOP_ALPHA}"`));
  assert.ok(PRISM_TOP_ALPHA > PRISM_BODY_ALPHA, 'translucent body, near-opaque edge');
  // WHITE, and only white: Cesium multiplies `billboard.color` into all four
  // channels, so one atlas entry serves the teal export and the orange import.
  // A hue baked in would cost two and would fight the tint.
  assert.equal(svg.match(/#ffffff/g).length, 2);
  // The halo is NOT the prism's — a prism separates itself from the ground by
  // being a lit volume, and this mark is a flat overlay whose background is
  // other marks OF THE SAME HUE. Without it, measured on the reader's own
  // screenshot, a teal arrow over teal prisms is the outline of the country.
  assert.match(svg, /rgba\(0,0,0,0\.72\)/);
  assert.ok(svg.indexOf('rgba(0,0,0') < svg.indexOf('#ffffff'), 'the halo goes UNDER the art');
  assert.ok(svg.includes(MAKI_PATHS.arrow), 'the vendored path, verbatim');
  // Cached per raster size, because it is rebuilt on every refresh.
  assert.equal(borderArrowGlyph(320), borderArrowGlyph(320));
  assert.notEqual(borderArrowGlyph(320), borderArrowGlyph(64));
});

test('every flow arrow points at the market it names, and four end inside it', () => {
  // The far end is a BEARING and not a destination, which is what lets one
  // length serve five markets whose reference points are 94 km to 411 km away.
  // Four of the five still land inside their own outline; the fifth is
  // recorded rather than hidden — see the header at ARROW_ABROAD_M.
  const frontier = frontierAnchors(BUNDLED);
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontier);
  const outlines = new Map(buildMarketOutlines(MARKET_AREAS).map((m) => [m.key, m.rings]));
  const inside = new Set();
  for (const arc of arcs) {
    const abroad = arc.importing ? arc.tail : arc.tip;
    if (outlines.get(arc.key).some((ring) => pointInRing(abroad, ring))) inside.add(arc.key);
    // Whether or not it lands inside, it is nearer its OWN market's reference
    // point than any other's — which is the claim the label makes.
    const own = greatCircleDistanceM(abroad, BORDER_ANCHORS[arc.key]);
    for (const [key, anchor] of Object.entries(BORDER_ANCHORS)) {
      if (key === 'france' || key === arc.key) continue;
      assert.ok(
        own < greatCircleDistanceM(abroad, anchor),
        `${arc.key} ends nearer ${key} than ${arc.key}`,
      );
    }
    // And the inland half lands in FRANCE, which is the other half of the
    // straddle: a mark that crosses a border has to have a side on each side.
    const inland = arc.importing ? arc.tip : arc.tail;
    assert.ok(
      BUNDLED.features.some((f) => {
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        return polys.some((poly) => pointInRing(inland, poly[0]));
      }),
      `${arc.key} inland end ${inland.map((v) => v.toFixed(2)).join('/')} is not in France`,
    );
  }
  // Italie is the one that does not: the great circle from the Alpine frontier
  // to central Italy crosses the Ligurian Sea, so 190 km out is water off
  // Genoa. Reaching further would only move the failure onto Switzerland,
  // whose reference point is 94 km from the border.
  assert.deepEqual([...inside].sort(), [
    'allemagne_belgique', 'angleterre', 'espagne', 'suisse',
  ]);
});

test('no two flow glyphs cross each other', () => {
  // The reach INTO France is what decides whether the reader sees five marks
  // or four and a knot. The Swiss and the Allemagne + Belgique frontier points
  // are 234 km apart and their inland bearings CONVERGE: at 190 km inland the
  // two axes cross, so each 200 km-deep head lands on the other's shaft. The
  // 110 km ceiling is what stops them short of the crossing, and this is the
  // assertion that keeps it there.
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontierAnchors(BUNDLED));
  // Orientation test on [lon, lat] — a plane approximation, which is what a
  // reader's eye applies to 300 km of glyph anyway.
  const side = ([ax, ay], [bx, by], [cx, cy]) => Math.sign(
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax),
  );
  const crosses = (p1, p2, q1, q2) => (
    side(p1, p2, q1) !== side(p1, p2, q2) && side(q1, q2, p1) !== side(q1, q2, p2)
  );
  for (let i = 0; i < arcs.length; i += 1) {
    for (let j = i + 1; j < arcs.length; j += 1) {
      assert.ok(
        !crosses(arcs[i].tail, arcs[i].tip, arcs[j].tail, arcs[j].tip),
        `${arcs[i].key} crosses ${arcs[j].key}`,
      );
    }
  }
});

test('a missing frontier costs the arrow its start, never its existence', () => {
  // The geometry has not loaded. An arrow drawn from slightly the wrong place
  // still says which way the power is going; a missing arrow says nothing.
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, new Map());
  assert.equal(arcs.length, 5);
  assert.ok(arcs.every((arc) => arc.fromFrontier === false));
  const swiss = arcs.find((arc) => arc.key === 'suisse');
  assert.ok(swiss.importing);
  assert.deepEqual(swiss.frontier, BORDER_ANCHORS.france);
  assert.deepEqual(frontierAnchors({ features: [] }), new Map());
});

test('a zero border is no arc at all, and an unknown border is dropped', () => {
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 0 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'lune', label: 'Lune', mw: 900 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: null }]), []);
  assert.deepEqual(buildBorderArcs(null), []);
});

test('arrow thickness ramps with the flow and saturates', () => {
  const [thin] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 50 }]);
  const [thick] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 2900 }]);
  const [clamped] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 25_000 }]);
  assert.ok(thick.depthM > thin.depthM);
  assert.ok(clamped.depthM >= thick.depthM && clamped.depthM <= 300_000);
  // The head follows the shaft for free: scaling the quad is rigid in image
  // space, so Maki's 5.6:1 head-to-shaft ratio survives every flow. What the
  // ramp changes is the ASPECT — a weak border is a long thin arrow.
  assert.ok(thin.depthM / thin.lengthM < 0.6);
  assert.equal(clamped.depthM, clamped.lengthM, 'the strongest flow draws the artwork undistorted');
  // Length is untouched by the megawatts, which is the whole point of it.
  assert.equal(thin.lengthM, thick.lengthM);
});

test('the course is the compass bearing of the flow, read at the glyph', () => {
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontierAnchors(BUNDLED));
  const course = (key) => Math.round(borderArrowCourseDeg(arcs.find((a) => a.key === key)));
  // Degrees CLOCKWISE FROM NORTH, which is what `screenProjectedRotation`
  // builds its east-north-up probe from. An export heads for its market; an
  // import heads back into France.
  assert.equal(arcs.find((a) => a.key === 'angleterre').importing, false);
  assert.ok(course('angleterre') > 290 && course('angleterre') < 340, `${course('angleterre')}`);
  assert.equal(arcs.find((a) => a.key === 'italie').importing, false);
  assert.ok(course('italie') > 80 && course('italie') < 130, `${course('italie')}`);
  assert.equal(arcs.find((a) => a.key === 'espagne').importing, true);
  assert.ok(course('espagne') > 10 && course('espagne') < 60, `${course('espagne')}`);
  assert.equal(arcs.find((a) => a.key === 'suisse').importing, true);
  assert.ok(course('suisse') > 290 && course('suisse') < 340, `${course('suisse')}`);

  // An import and an export across the SAME frontier are 180° apart, which is
  // the property that would have caught the mark pointing at the wrong country.
  const [out] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: -500 }]);
  const [back] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: 500 }]);
  const apart = Math.abs(borderArrowCourseDeg(out) - borderArrowCourseDeg(back));
  assert.ok(Math.abs(apart - 180) < 1, String(apart));

  assert.equal(borderArrowCourseDeg(null), null);
  assert.equal(borderArrowCourseDeg({ anchor: [2, 46] }), null);
  assert.equal(borderArrowCourseDeg({ anchor: [2, 46], tip: [2, 46] }), null);
});

test('the arrow is aimed by the shared orientation module, not by this layer', () => {
  // `iconOrientation.js` owns screen-space aim for every camera-facing quad in
  // this project, and its contract is `rotation = 0` ⇒ the icon points UP. The
  // artwork is turned once to match it; a layer that invented its own
  // convention next to that module is how this mark came to point at the wrong
  // country. So the texture must carry the quarter turn…
  const svg = Buffer.from(borderArrowGlyph(64).split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /transform="rotate\(-90 7\.5 7\.5\)"/);

  // …and a scene that cannot project keeps the rotation the arrow already had,
  // rather than snapping it north.
  const [arc] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: 500 }]);
  assert.equal(borderArrowRotation({ globe: {} }, arc, 0.5), 0.5);
  assert.equal(borderArrowRotation(null, arc, 0.5), 0.5);
  assert.equal(borderArrowRotation({ camera: {} }, null, 0.5), 0.5);
});

test('the five real borders all resolve, Allemagne+Belgique as one arc', () => {
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges);
  assert.equal(arcs.length, 5);
  const combined = arcs.find((arc) => arc.key === 'allemagne_belgique');
  assert.ok(combined);
  assert.match(borderLabelText(combined), /Allemagne \+ Belgique/);
});

// ── Presentation ────────────────────────────────────────────────────────────

test('the dissolve turns 96 départements into 13 régions and no seams', () => {
  const shapes = buildRegionShapes(BUNDLED);
  assert.equal(shapes.size, 13, 'twelve measured régions plus Corse');
  let marks = 0;
  for (const [code, shape] of shapes) {
    // ONE prism per région on the real file — the whole point of the dissolve.
    assert.equal(shape.prismRings.length, 1, `région ${code} draws ${shape.prismRings.length}`);
    marks += shape.prismRings.length;
    // The perimeter keeps the islands the prism drops.
    assert.ok(shape.rings.length >= shape.prismRings.length);
    assert.ok(Math.abs(ringArea(shape.rings[0])) >= Math.abs(ringArea(shape.rings.at(-1))));
  }
  assert.equal(marks, 13);
  // Île-de-France: eight départements in, one closed outline out, and the 139
  // shared segments that used to draw the seams are not in it.
  const idf = buildRegionShapes(BUNDLED).get('11');
  assert.deepEqual(idf.rings[0][0], idf.rings[0].at(-1));
  assert.ok(idf.rings[0].length < 250, `${idf.rings[0].length} points`);
  assert.deepEqual(buildRegionShapes(null), new Map());
});

test('the market outlines are whitelisted on the fields éCO2mix publishes', () => {
  const outlines = buildMarketOutlines(TEST_MARKETS);
  assert.deepEqual(outlines.map((entry) => entry.key), ['espagne', 'italie']);
  assert.equal(outlines[1].rings.length, 2, 'a MultiPolygon keeps its parts');
  assert.ok(!outlines.some((entry) => entry.key === 'luxembourg'));
  assert.deepEqual(buildMarketOutlines(null), []);

  // The bundled file: five markets, and Germany + Belgium in ONE entry because
  // they are ONE upstream field.
  const bundled = buildMarketOutlines(MARKET_AREAS);
  assert.deepEqual(
    bundled.map((entry) => entry.key).sort(),
    ['allemagne_belgique', 'angleterre', 'espagne', 'italie', 'suisse'],
  );
  assert.equal(bundled.find((entry) => entry.key === 'allemagne_belgique').rings.length, 2);
  assert.match(bundled.find((entry) => entry.key === 'allemagne_belgique').label, /Belgique/);
});

test('an outline takes its arc class, and slate when nothing crosses', () => {
  const styles = marketOutlineStyles(buildBorderArcs(PAYLOAD.national.exchanges));
  assert.equal(styles.size, 5);
  // +500 MW from Spain is an import; −2 537 MW to Italy is an export.
  assert.equal(styles.get('espagne'), BALANCE_STYLES.importer);
  assert.equal(styles.get('italie'), BALANCE_STYLES.exporter);
  // No arc at all — the market is still a neighbour and still gets a line.
  assert.equal(marketOutlineStyles([]).get('suisse'), BALANCE_STYLES.balanced);
  assert.equal(marketOutlineStyles(null).size, 5);
  assert.ok(!marketOutlineStyles([]).has('france'));
});

test('a région the feed DROPS is counted and named, not silently lost', () => {
  // The bug the first reader found by eye: éCO2mix dropped Normandie from the
  // 15:04Z poll, the map drew twelve prisms and two striped shapes, and the
  // legend said « non publié 1 ». 11 + 1 is not 13.
  const dropped = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.filter((region) => region.code !== '28'),
  };
  const records = buildRegionRecords(dropped, parseDepartements(BUNDLED));
  assert.equal(records.length, 11);

  const missing = unmeasuredRegions(records);
  assert.deepEqual(missing.map((region) => region.code), ['28', '94']);
  assert.deepEqual(missing.map((region) => region.name), ['Normandie', 'Corse']);
  // The legend no longer names them — it is two rows now, by instruction — so
  // the arithmetic a reader could once do on it is done here instead: eleven
  // measured plus two unmeasured is the thirteen régions this layer knows.
  assert.equal(records.length + missing.length, 13);
});

test('a published NULL and a dropped région are the same absence', () => {
  // Three causes — never published (Corse), published null, dropped from the
  // payload — and one mark, so one count. Telling them apart in the arithmetic
  // would promise a distinction the map does not draw.
  const nulled = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.map((region) => (
      region.code === '53' ? { ...region, netPhysical: null } : region
    )).filter((region) => region.code !== '28'),
  };
  const records = buildRegionRecords(nulled, parseDepartements(BUNDLED));
  assert.deepEqual(unmeasuredRegions(records).map((r) => r.code), ['28', '53', '94']);
  assert.equal(unmeasuredRegions([]).length, Object.keys(REGION_DEPARTEMENTS).length);
  assert.equal(unmeasuredRegions(null).length, Object.keys(REGION_DEPARTEMENTS).length);
});

test('the name table covers the grouping exactly, or a région goes anonymous', () => {
  assert.deepEqual(
    Object.keys(REGION_NAMES).sort(),
    Object.keys(REGION_DEPARTEMENTS).sort(),
  );
  // The names have to match what éCO2mix itself publishes, or a région renames
  // itself the moment the feed drops it.
  for (const region of PAYLOAD.regions) {
    if (!REGION_NAMES[region.code]) continue;
    assert.equal(REGION_NAMES[region.code], region.name, `région ${region.code}`);
  }
});

test('labels carry the verb and the megawatts, never colour alone', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const idf = records.find((record) => record.code === '11');
  const text = regionLabelText(idf);
  assert.match(text, /Île-de-France/);
  assert.match(text, /IMPORTE/);
  assert.match(text, /MW$/);
  // No minus sign leaks into the figure: the verb carries the sign. (Checked
  // on the value alone — "Île-de-France" is full of hyphens.)
  const figure = text.split('·')[1];
  assert.ok(!figure.includes('-') && !figure.includes('\u2212'), figure);

  const [arc] = buildBorderArcs([{ key: 'italie', label: 'Italie', mw: -2537 }]);
  assert.equal(borderLabelText(arc), '2 537 MW exportés vers Italie');
  const [inbound] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 750 }]);
  assert.equal(borderLabelText(inbound), '750 MW importés depuis Suisse');
  // The deadband admits a single megawatt, and the participle agrees with it.
  const [single] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: -1 }]);
  assert.equal(borderLabelText(single), '1 MW exporté vers Suisse');
});

test('a région with no published balance says so, and says it in words', () => {
  // It used to read « ÉQUILIBRÉE », which asserted a measurement nobody made.
  assert.match(regionLabelText({ name: 'Corse', balance: null }), /SOLDE NON PUBLIÉ/);
  assert.equal(regionLabelHeightM({ name: 'Corse', netPhysical: null }), 0);
});

test('the label rides at the TOP of its prism, not on the ground', () => {
  // B2 asks for a height read against a vertical guide. Here the guide is the
  // label: it states the megawatts at the altitude the length reaches. Left on
  // the ground it would sit behind 78 km of translucent volume.
  const aura = { code: '84', name: 'Auvergne-Rhône-Alpes', netPhysical: -7781 };
  assert.equal(regionLabelHeightM(aura), energyPrismRow(aura).heightM);
  assert.ok(regionLabelHeightM(aura) > 70_000);
  // A measured zero has no prism, so its label stays on the ground.
  assert.equal(regionLabelHeightM({ code: '11', netPhysical: 0 }), 0);
});

test('formatMegawatts is sign-free, grouped, and honest about absence', () => {
  assert.equal(formatMegawatts(6478), '6 478 MW');
  assert.equal(formatMegawatts(-6478), '6 478 MW');
  assert.equal(formatMegawatts(0), '0 MW');
  assert.equal(formatMegawatts(null), '— MW');
  assert.equal(formatMegawatts(Number.NaN), '— MW');
  // No exotic space codepoints survive into the label.
  assert.ok(!/[  ]/.test(formatMegawatts(1_234_567)));
});

test('border labels outrank régions in the collision cohort', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges);
  const entries = [
    ...records.map((r) => ({ id: `r${r.code}`, priority: Math.abs(r.netPhysical) })),
    ...arcs.map((a) => ({ id: `b${a.key}`, priority: 1_000_000 + Math.abs(a.mw) })),
  ];
  const cohort = selectEnergyOverlayCohort(entries);
  assert.equal(cohort.length, Math.min(entries.length, ENERGY_OVERLAY_COHORT_LIMIT));
  assert.ok(cohort.slice(0, 5).every((entry) => entry.id.startsWith('b')));
  assert.deepEqual(selectEnergyOverlayCohort(entries, 0), []);
  assert.deepEqual(selectEnergyOverlayCohort(null), []);
});

test('the legend is TWO ROWS: excédentaire, déficitaire, and nothing else', () => {
  // Asked for in those words, and it is a deletion rather than a collapse: a
  // hidden row is still a row. What went: the height ruler and its three
  // ticks, the reduced-footprint row, the "what colour is allowed to mean"
  // row, the clipped-domain row, the measured-zero row, the « non publié »
  // row, the flow row and the market-outline row. Nine became two.
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const legend = energyPrismLegend(records);
  assert.equal(legend.length, 2, legend.map((e) => e.label).join(' · '));

  const [surplus, deficit] = legend;
  assert.match(surplus.label, /^Excédentaire/);
  assert.equal(surplus.color, BALANCE_STYLES.exporter.color);
  assert.equal(surplus.count, 5);
  assert.equal(surplus.blurb, BALANCE_STYLES.exporter.blurb);
  assert.match(deficit.label, /^Déficitaire/);
  assert.equal(deficit.color, BALANCE_STYLES.importer.color);
  assert.equal(deficit.count, 7);
  assert.equal(deficit.blurb, BALANCE_STYLES.importer.blurb);

  // One line each, and a concrete one: what a région that is not an
  // electricity analyst's is actually being told.
  for (const entry of legend) {
    assert.ok(entry.blurb.length < 60, entry.blurb);
    assert.ok(!/rapport/.test(entry.blurb));
    assert.ok(!('glyph' in entry), 'no ruler bars survive');
  }

  // The deadband class is real and is NOT shown: « sous 1 MW » is a threshold,
  // not something a reader came to learn.
  assert.ok(!legend.some((entry) => entry.color === BALANCE_STYLES.balanced.color));
  // And no second argument is consulted any more — markets and borders had
  // rows and no longer do.
  assert.deepEqual(energyPrismLegend(records, { markets: 5, borders: 5 }), legend);
  assert.deepEqual(energyPrismLegend([]), []);
});

test('the low-carbon share is taken against GENERATION, not consumption', () => {
  // On an export hour, dividing by consumption reports a share above 100%.
  const summary = summarizeNational(PAYLOAD.national);
  assert.ok(summary.lowCarbonShare > 0 && summary.lowCarbonShare <= 100);
  assert.ok(PAYLOAD.national.generation > PAYLOAD.national.load, 'the captured hour was an export hour');
  const naive = (PAYLOAD.national.lowCarbon / PAYLOAD.national.load) * 100;
  assert.ok(naive > 100, 'the naive denominator really does overflow here');
  assert.equal(summary.topFiliere.key, 'nucleaire');

  const empty = summarizeNational(null);
  assert.equal(empty.lowCarbonShare, null);
  assert.equal(empty.topFiliere, null);
  assert.equal(summarizeNational({ generation: 0, lowCarbon: 0 }).lowCarbonShare, null);
});

test('the analyst record restates the balance in the direction a human asks it', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const aura = mapAnalystRecord(records.find((record) => record.code === '84'));
  // Upstream −7 781 (consumption minus generation) → "sent 7 781 MW out".
  assert.equal(aura.netExportMw, 7781);
  assert.equal(aura.balance, 'exporter');
  assert.equal(aura.name, 'Auvergne-Rhône-Alpes');
  assert.ok(Number.isFinite(aura.lat) && Number.isFinite(aura.lon));

  const idf = mapAnalystRecord(records.find((record) => record.code === '11'));
  assert.equal(idf.netExportMw, -6478);

  // The variable the fill alpha used to carry (A3) and the metres the map
  // actually draws, so an analyst can check the picture against the figure.
  assert.ok(aura.exchangeRatio > 1.2 && aura.exchangeRatio < 1.25);
  assert.equal(Math.round(aura.prismHeightM), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
  assert.equal(mapAnalystRecord({ code: '94', netPhysical: null }).prismHeightM, null);

  const blank = mapAnalystRecord(null, 3);
  assert.equal(blank.id, 'REGION-0003');
  for (const key of ['name', 'loadMw', 'netExportMw', 'lat', 'lon']) {
    assert.equal(blank[key], null, key);
  }
});

test('the fill classifies against the ACTIVE surface only', () => {
  assert.equal(
    energyClassificationTypeForStack('google-photorealistic'),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(energyClassificationTypeForStack('osm-globe'), Cesium.ClassificationType.TERRAIN);
  // An unknown stack falls back to BOTH rather than risking drawing nothing.
  assert.equal(energyClassificationTypeForStack(null), Cesium.ClassificationType.BOTH);
  assert.equal(energyClassificationTypeForStack(''), Cesium.ClassificationType.BOTH);
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Four real départements spanning three régions, one of them Corsican. */
const TEST_SHAPES = {
  type: 'FeatureCollection',
  features: ['75', '95', '69', '2A'].map((code, index) => {
    const square = (x, y, size) => [[
      [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
    ]];
    return {
      type: 'Feature',
      properties: { code, nom: `Test ${code}` },
      geometry: code === '69'
        ? { type: 'MultiPolygon', coordinates: [square(index, 45, 0.8), square(index, 46.5, 0.2)] }
        : { type: 'Polygon', coordinates: square(index, 45, 0.8) },
    };
  }),
};

test('the harness fixture still spans three régions and a MultiPolygon', () => {
  const index = departementRegionIndex();
  const regions = new Set(TEST_SHAPES.features.map((f) => index.get(f.properties.code)));
  assert.deepEqual([...regions].sort(), ['11', '84', '94']);
  assert.equal(TEST_SHAPES.features.find((f) => f.geometry.type === 'MultiPolygon').properties.code, '69');
});

/**
 * Two of the five markets, one of them in two rings.
 *
 * Suisse is deliberately ABSENT: a market file that carries no shape for a
 * border must cost that border its outline and nothing else — not its arc, not
 * its label, not the layer.
 */
const TEST_MARKETS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { key: 'espagne', label: 'Espagne' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-5, 39], [-1, 39], [-1, 42], [-5, 42], [-5, 39]]],
      },
    },
    {
      type: 'Feature',
      properties: { key: 'italie', label: 'Italie' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[10, 42], [14, 42], [14, 45], [10, 45], [10, 42]]],
          [[[13, 37], [15, 37], [15, 38], [13, 38], [13, 37]]],
        ],
      },
    },
    // Not a border éCO2mix publishes: dropped by the whitelist rather than
    // drawn as a country nobody exchanges with.
    {
      type: 'Feature',
      properties: { key: 'luxembourg', label: 'Luxembourg' },
      geometry: { type: 'Polygon', coordinates: [[[6, 49], [7, 49], [7, 50], [6, 50], [6, 49]]] },
    },
  ],
};

function createHarness(polls, shapes = TEST_SHAPES, markets = TEST_MARKETS) {
  const dataSources = [];
  const hostCalls = [];
  const fetchUrls = [];
  let poll = 0;
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: { globe: { show: false }, requestRender() {} },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return Promise.resolve(dataSource); },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchUrls.push(String(url));
    const payload = polls[Math.min(poll++, polls.length - 1)];
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  const mapStackEventTarget = new EventTarget();
  const layer = createFranceEnergyLayer({
    overlayHost,
    departementsGeoJson: shapes,
    marketAreasGeoJson: markets,
    mapStackEventTarget,
  });
  return {
    layer,
    viewer,
    dataSources,
    hostCalls,
    fetchUrls,
    mapStackEventTarget,
    entities: () => dataSources[0]?.entities?.values || [],
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('a région is ONE mark, and its départements are gone from the scene', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const shown = h.entities().filter((entity) => entity.polygon && entity.show);
    const codes = shown.map((entity) => entity.properties.code.getValue()).sort();
    // RÉGION codes, not département codes. The fixture's Île-de-France squares
    // do not touch, so région 11 keeps two rings — a dissolve merges what is
    // adjacent and honestly refuses to merge what is not. Auvergne-Rhône-Alpes
    // is one mark: its 0.04 deg² island is under the prism threshold.
    assert.deepEqual(codes, ['11', '11', '84', '94']);
    assert.ok(!codes.includes('75'), 'no département reaches the scene any more');
    assert.ok(!codes.includes('69'));

    const marksOf = (code) => shown.filter((e) => e.properties.code.getValue() === code);
    const heightOf = (code) => marksOf(code)[0].polygon.extrudedHeight.getValue();

    // Both rings of Île-de-France share ONE material and ONE height: they are
    // one measurement, and nothing about the drawing may suggest two.
    const [first, second] = marksOf('11');
    assert.equal(first.polygon.material, second.polygon.material);
    assert.equal(
      first.polygon.extrudedHeight.getValue(),
      second.polygon.extrudedHeight.getValue(),
    );
    // The base is the ELLIPSOID for every prism, or the tops stop being
    // comparable the moment the terrain moves.
    assert.equal(first.polygon.height.getValue(), 0);
    assert.equal(first.polygon.perPositionHeight.getValue(), false);

    // Auvergne-Rhône-Alpes exports 7 781 MW against Île-de-France's 6 478 MW
    // import: taller AND a different colour. Both facts, one mark.
    assert.ok(heightOf('84') > heightOf('11'));
    assert.equal(Math.round(heightOf('84')), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
    const colorOf = (code) => marksOf(code)[0].polygon.material.color.getValue();
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.ok(colorOf('11').red === amber.red && colorOf('11').green === amber.green);
    assert.ok(colorOf('84').red === teal.red && colorOf('84').green === teal.green);
    // The body is translucent and the silhouette is not: the top edge is the
    // reading instrument, so it gets the outline a clamped fill cannot have.
    assert.equal(colorOf('11').alpha, PRISM_BODY_ALPHA);
    assert.equal(first.polygon.outline.getValue(), true);
    assert.equal(first.polygon.outlineColor.getValue().alpha, PRISM_TOP_ALPHA);
  } finally {
    h.restore();
  }
});

test('the prism stands on a REDUCED footprint, and the true one is drawn under it', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const shapes = buildRegionShapes(TEST_SHAPES);
    const ring = shapes.get('84').rings[0];
    const inset = shapes.get('84').prismRings[0];
    // The footprint is the SAME SHAPE, smaller: same vertex count, area down
    // by the square of the factor. A buffer would have changed both.
    assert.equal(inset.length, ring.length);
    assert.ok(Math.abs(
      Math.abs(ringArea(inset)) / Math.abs(ringArea(ring)) - PRISM_FOOTPRINT_SCALE ** 2,
    ) < 1e-9);

    // The prism polygon is built on the reduced ring, and a perimeter polyline
    // on the true one is shown beneath it in the same colour. Without that
    // line nothing on the globe says where the région ends.
    const perimeters = h.entities().filter((entity) => (
      entity.polyline && String(entity.id).startsWith('energy-fr:perimeter:')
    ));
    assert.ok(perimeters.length >= 4, `${perimeters.length} perimeter lines`);
    assert.ok(perimeters.every((entity) => entity.show));
    assert.ok(perimeters.every((entity) => entity.polyline.clampToGround.getValue()));
    const aura = perimeters.find((e) => String(e.id) === 'energy-fr:perimeter:84:0');
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.equal(aura.polyline.material.color.getValue().red, teal.red);
    assert.ok(aura.polyline.material.color.getValue().alpha < PRISM_TOP_ALPHA);

    // The 0.04 deg² island of Auvergne-Rhône-Alpes carries a perimeter and NO
    // prism: a 78 km column on a speck measures its région and looks like it
    // measures the island.
    assert.ok(h.entities().some((e) => String(e.id) === 'energy-fr:perimeter:84:1'));
    assert.ok(!h.entities().some((e) => String(e.id) === 'energy-fr:region:84:1'));
  } finally {
    h.restore();
  }
});

test('the neighbouring markets are delimited, and never filled', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const outlines = h.entities().filter((entity) => (
      String(entity.id).startsWith('energy-fr:market:')
    ));
    assert.equal(outlines.length, 3, 'one entity per ring of the test outlines');
    // A LINE and nothing else. A filled foreign polygon is what a measurement
    // looks like in this layer, and nothing inside Spain was measured.
    assert.ok(outlines.every((entity) => entity.polyline && !entity.polygon));
    assert.ok(outlines.every((entity) => entity.show));
    assert.ok(outlines.every((entity) => entity.polyline.clampToGround.getValue()));

    const colorOf = (key) => outlines
      .find((entity) => String(entity.id).startsWith(`energy-fr:market:${key}:`))
      .polyline.material.color.getValue();
    // Espagne is +500 MW upstream, i.e. France IMPORTS from it: amber, the
    // same class as its arc. Italie is an export: teal.
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.equal(colorOf('espagne').red, amber.red);
    assert.equal(colorOf('italie').red, teal.red);
    // Suisse has no outline in the fixture and no entity: a market file that
    // does not carry a shape costs its outline and nothing else.
    assert.ok(!outlines.some((entity) => String(entity.id).includes('suisse')));
  } finally {
    h.restore();
  }
});

test('a market file that fails costs the outlines and nothing else', async () => {
  // The harness fetch answers every URL with the éCO2mix payload, so the
  // market file comes back as a document with no `key` on any feature — the
  // realistic shape of a bad deploy. The régions and the arcs must survive it,
  // and the legend must stop promising a mark nobody drew.
  const h = createHarness([PAYLOAD], TEST_SHAPES, null);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    assert.ok(!h.entities().some((e) => String(e.id).startsWith('energy-fr:market:')));
    assert.equal(h.layer.getStats().count, 12);
    assert.equal(h.layer.getStats().borders, 5);
    assert.ok(!h.layer.getRowControls().legend.some((entry) => /^Contour — /.test(entry.label)));
  } finally {
    h.restore();
  }
});

test('a market whose flow dies keeps its outline, in slate', async () => {
  // An arc is a DIRECTION and a direction of nothing is nothing, so it goes.
  // An outline answers "who is on the other side", which stays true at zero.
  const zeroed = {
    ...PAYLOAD,
    national: {
      ...PAYLOAD.national,
      exchanges: PAYLOAD.national.exchanges.map((entry) => (
        entry.key === 'espagne' ? { ...entry, mw: 0 } : entry
      )),
    },
  };
  const h = createHarness([zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const spain = h.entities().find((e) => String(e.id) === 'energy-fr:market:espagne:0');
    assert.equal(spain.show, true);
    assert.equal(
      spain.polyline.material.color.getValue().red,
      Cesium.Color.fromCssColorString(BALANCE_STYLES.balanced.color).red,
    );
    assert.ok(!h.entities().some((e) => String(e.id) === 'energy-fr:arc:espagne' && e.show));
  } finally {
    h.restore();
  }
});

test('Corsica is a striped footprint, never a prism of height zero', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const corse = h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === '94'
    ));
    // Visible — a hidden Corsica made "not published" look like "nothing here",
    // which a height channel cannot afford (A1/A4).
    assert.equal(corse.show, true);
    assert.equal(corse.polygon.extrudedHeight, undefined, 'no prism, not even a flat one');
    assert.equal(corse.polygon.height, undefined, 'clamped, or the terrain swallows it');
    // A MOTIF and not a tint (D3), and still classified, because a footprint on
    // the ground is exactly the thing classification is for.
    assert.ok(corse.polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.ok(corse.polygon.classificationType);
    // Its perimeter is drawn too: even the région nobody measures has to say
    // where it is, and it says it in the slate of the unmeasured.
    const edge = h.entities().find((e) => String(e.id) === 'energy-fr:perimeter:94:0');
    assert.equal(edge.show, true);
    assert.equal(
      edge.polyline.material.color.getValue().red,
      Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR).red,
    );
    // And it never enters the analyst snapshot or the count.
    assert.ok(!h.layer.getAnalystRecords().some((row) => row.id === '94'));
  } finally {
    h.restore();
  }
});

test('the three marks A1 asks for are three different marks', async () => {
  // Measured (prism) / measured at zero (flat, filled, opaque) / not published
  // (flat, striped). Île-de-France is forced to an exact zero so all three sit
  // on the same frame.
  const zeroed = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.map((region) => (
      region.code === '11' ? { ...region, netPhysical: 0 } : region
    )),
  };
  const h = createHarness([zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const at = (code) => h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === code
    ));
    const prism = at('84');
    const zero = at('11');
    const absent = at('94');

    assert.ok(prism.polygon.extrudedHeight.getValue() > 0);
    assert.equal(zero.polygon.extrudedHeight, undefined);
    assert.equal(absent.polygon.extrudedHeight, undefined);

    // The zero is FILLED and OPAQUE in the balanced slate; the absence is
    // striped. They must not be the same pixel.
    assert.equal(
      zero.polygon.material.color.getValue().alpha,
      PRISM_TOP_ALPHA,
      'a measured zero is drawn, and drawn solidly',
    );
    assert.equal(
      zero.polygon.material.color.getValue().red,
      Cesium.Color.fromCssColorString(BALANCE_STYLES.balanced.color).red,
    );
    assert.ok(absent.polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.ok(!(zero.polygon.material instanceof Cesium.StripeMaterialProperty));
    // Both flat marks go back on the ground and take the classification.
    assert.ok(zero.polygon.classificationType);
    assert.equal(zero.polygon.height, undefined);

    // The legend no longer counts the zero — it is two rows now — but the
    // three marks are still three, which is what A1 asks for and what this
    // test is named after. The count lives on in `getStats()`.
    assert.equal(h.layer.getRowControls().legend.length, 2);
    // Corse, and Corse alone: counted from the KNOWN 13 régions rather than
    // from the rows the payload carried, which is what used to lose a région
    // the feed had dropped.
    assert.equal(h.layer.getStats().unpublishedRegions, 1);
  } finally {
    h.restore();
  }
});

test('a région the upstream drops becomes striped, not stale', async () => {
  const dropped = { ...PAYLOAD, regions: PAYLOAD.regions.filter((r) => r.code !== '84') };
  const h = createHarness([PAYLOAD, dropped]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const rhone = () => h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === '84'
    ));
    assert.ok(rhone().polygon.extrudedHeight.getValue() > 0);

    await h.layer.update(h.viewer);
    // Not a stale 78 km prism, and not a hole either: a declared absence.
    assert.equal(rhone().polygon.extrudedHeight, undefined);
    assert.ok(rhone().polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.equal(h.layer.getStats().count, 11);
  } finally {
    h.restore();
  }
});

test('the five border flows are drawn as one ready-made arrow each', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const arcs = h.entities().filter((entity) => String(entity.id).startsWith('energy-fr:arc:'));
    assert.equal(arcs.length, 5);
    // ONE entity per flow. The tube and the cone were a pair that had to be
    // shown and hidden together; nothing here draws a second half.
    assert.equal(
      h.entities().filter((e) => String(e.id).startsWith('energy-fr:arc-head:')).length,
      0,
    );
    for (const arc of arcs) {
      assert.ok(arc.show);
      assert.ok(arc.billboard, 'the flow is a billboard');
      assert.equal(arc.polylineVolume, undefined, 'the swept tube is gone');
      assert.equal(arc.cylinder, undefined, 'and so is the cone');
      // Maki's artwork, not a shape this layer builds. The data URI is the
      // SAME string for all five: white art tinted by a per-billboard multiply
      // costs one atlas entry, a baked hue would cost two.
      assert.equal(arc.billboard.image.getValue(), borderArrowGlyph(320));

      // METRES, like every other mark here — a screen size would leave the
      // flow a hairline while the prisms beside it grow.
      assert.equal(arc.billboard.sizeInMeters.getValue(), true);
      // SWAPPED by the upright transform: the artwork's long side runs up the
      // texture, so `height` is the glyph's length and `width` its depth.
      assert.equal(arc.billboard.height.getValue(), 300_000);
      const depth = arc.billboard.width.getValue();
      assert.ok(depth >= 150_000 && depth <= 300_000, `${depth} m`);

      // Aimed by a CALLBACK, because the angle depends on where the camera
      // is — and NOT by `alignedAxis`, whose shader trigonometry is off by up
      // to 15° between the cardinal directions.
      assert.equal(arc.billboard.alignedAxis, undefined);
      assert.equal(arc.billboard.rotation.isConstant, false);
      assert.ok(Number.isFinite(arc.billboard.rotation.getValue(Cesium.JulianDate.now())));
      // Opaque: the mark IS the sense now, so nothing is spent on translucency.
      assert.equal(arc.billboard.color.getValue().alpha, 1);
      assert.ok(arc.position, 'the arrow is placed on the flow');
    }
  } finally {
    h.restore();
  }
});

test('a border that falls to zero hides its arc rather than drawing a hairline', async () => {
  const zeroed = {
    ...PAYLOAD,
    national: {
      ...PAYLOAD.national,
      exchanges: PAYLOAD.national.exchanges.map((entry) => (
        entry.key === 'suisse' ? { ...entry, mw: 0 } : entry
      )),
    },
  };
  const h = createHarness([PAYLOAD, zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    const arcs = (only = false) => h.entities().filter((e) => (
      String(e.id).startsWith('energy-fr:arc:') && (!only || e.show)
    ));
    await h.layer.update(h.viewer);
    assert.equal(arcs(true).length, 5);

    await h.layer.update(h.viewer);
    assert.equal(arcs(true).length, 4);
    // The entity is kept and hidden, not destroyed — the next refresh reuses it.
    assert.equal(arcs().length, 5);
    assert.equal(h.layer.getStats().borders, 4);
  } finally {
    h.restore();
  }
});

test('an unchanged snapshot does not republish the overlay', async () => {
  const h = createHarness([PAYLOAD, PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const after = h.hostCalls.filter((call) => call[0] === 'entries').length;
    await h.layer.update(h.viewer);
    assert.equal(h.hostCalls.filter((call) => call[0] === 'entries').length, after);
  } finally {
    h.restore();
  }
});

test('the overlay publishes one entry per painted région plus one per arc', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const [, sourceId, entries, options] = h.hostCalls.findLast((call) => call[0] === 'entries');
    assert.equal(sourceId, 'france-energy');
    assert.equal(options.cohortLimit, ENERGY_OVERLAY_COHORT_LIMIT);
    assert.equal(options.collisionCapacity, ENERGY_OVERLAY_COLLISION_CAPACITY);
    assert.equal(options.moving, false);
    // The harness only bundles four départements, so only the régions whose
    // départements are present get an anchor: IDF and AURA measured, plus
    // Corse — which is UNMEASURED and labelled anyway. That last one is the
    // fix: a striped shape with no name is what sent the first reader hunting
    // for the missing région along the coastline.
    const borders = entries.filter((entry) => entry.id.startsWith('energy-fr:border:'));
    const regions = entries.filter((entry) => entry.id.startsWith('energy-fr:region:'));
    assert.equal(borders.length, 5);
    assert.equal(regions.length, 3, 'IDF, AURA, and an unmeasured Corse');
    for (const entry of entries) assert.equal(entry.interactive, false);

    const corse = regions.find((entry) => entry.id === 'energy-fr:region:94');
    assert.match(corse.title, /^Corse · SOLDE NON PUBLIÉ$/);
    assert.equal(corse.accent, PRISM_NO_RATIO_COLOR);
    // On the ground: it has no prism, so there is no top to ride.
    assert.equal(Math.round(Cesium.Cartographic.fromCartesian(corse.position).height), 0);

    // Every MEASURED région label is lifted to the top of its own prism, so the
    // number and the length it encodes are read in the same glance.
    for (const entry of regions.filter((row) => row.id !== 'energy-fr:region:94')) {
      const height = Cesium.Cartographic.fromCartesian(entry.position).height;
      assert.ok(height > 50_000, `${entry.id} sits at ${height} m, near its base`);
    }
  } finally {
    h.restore();
  }
});

test('an HTTP error keeps the last good paint instead of blanking the map', async () => {
  const h = createHarness([PAYLOAD, { status: 503 }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const before = h.entities().filter((entity) => entity.show).length;

    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.entities().filter((entity) => entity.show).length, before);
    assert.match(h.layer.getStats().error, /503/);
  } finally {
    h.restore();
  }
});

test('a thrown fetch is reported, not swallowed as an empty grid', async () => {
  const h = createHarness([new Error('offline')]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'éCO2mix network error');
    assert.equal(h.layer.getStats().count, 0);
  } finally {
    h.restore();
  }
});

test('getStats restates the national balance as an EXPORT figure', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const stats = h.layer.getStats();
    assert.equal(stats.count, 12);
    // A5 in the HUD as well as in the legend, and both zero on this snapshot.
    assert.equal(stats.clippedRegions, 0);
    assert.equal(stats.unpublishedRegions, 1, 'Corse is never published');
    assert.equal(stats.netExportMw, -PAYLOAD.national.netPhysical);
    assert.ok(stats.netExportMw > 0, 'France was exporting on the captured snapshot');
    // Physical and commercial are reported under distinct names because they
    // are different numbers — see the module header.
    assert.notEqual(stats.netExportMw, stats.netCommercialExportMw);
    assert.equal(stats.co2gPerKwh, PAYLOAD.national.co2);
    assert.equal(stats.topFiliere, 'Nucléaire');
    assert.equal(stats.updateTime, PAYLOAD.national.at);
    assert.equal(stats.feedSource, 'test');
    assert.equal(stats.borders, 5);
  } finally {
    h.restore();
  }
});

test('analyst records are gated on the layer being enabled', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getAnalystRecords().length, 12);
    assert.equal(h.layer.getAnalystRecords(3).length, 3);

    h.layer.disable(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
  } finally {
    h.restore();
  }
});

test('the map-stack event reclassifies the FOOTPRINTS and skips the prisms', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'google-photorealistic' },
    }));

    let prisms = 0;
    let footprints = 0;
    for (const entity of h.entities()) {
      if (!entity.polygon || !entity.show) continue;
      if (entity.polygon.extrudedHeight !== undefined) {
        // An extruded polygon is not a GroundPrimitive: `_isOnTerrain` returns
        // false as soon as `extrudedHeight` is defined, so a classification set
        // here would be read and ignored in silence. Not setting it is the
        // honest state, and it is what keeps a reader from believing otherwise.
        assert.equal(entity.polygon.classificationType, undefined);
        prisms += 1;
      } else {
        assert.equal(
          entity.polygon.classificationType.getValue(),
          Cesium.ClassificationType.CESIUM_3D_TILE,
        );
        footprints += 1;
      }
    }
    assert.ok(prisms > 0 && footprints > 0, `${prisms} prisms, ${footprints} footprints`);
  } finally {
    h.restore();
  }
});

test('destroy releases the data source, the overlay, and the listener', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.dataSources.length, 1);

    h.layer.destroy(h.viewer);
    assert.equal(h.dataSources.length, 0);
    assert.ok(h.hostCalls.some((call) => call[0] === 'clear' && call[1] === 'france-energy'));
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.layer.getStats().borders, 0);
    // The listener is gone: a later stack change must not touch a dead layer.
    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'osm-globe' },
    }));
  } finally {
    h.restore();
  }
});
