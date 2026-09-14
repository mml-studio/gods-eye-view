// src/data/powerGridFeed.test.mjs
// Pins the UPSTREAM OpenStreetMap power schema against a real captured Overpass
// response. This is the projection the dev-server proxy runs, so it is where a
// tagging drift shows up first — and it is where the six traps documented in
// powerGridFeed.js are held down: the starving element cap, the `;`-separated
// voltage list, the 400-volt "power line", the industrial poste source, the
// positionless relation, and the underground half of the same network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  POWER_GRID_CAPS,
  POWER_GRID_CASING_PX,
  POWER_GRID_MAX_BOX_DEG,
  POWER_GRID_MIN_VOLTAGE_V,
  POWER_GRID_TIERS,
  POWER_GRID_TOWER_MAX_BOX_DEG,
  POWER_GRID_VOLTAGE_PREFILTER,
  POWER_SUBSTATION_ROLE_UNSTATED,
  POWER_PYLON_GAP_PX,
  POWER_PYLON_MIN_SPACING_M,
  POWER_PYLON_MIN_WAY_M,
  POWER_PYLON_MAX_SPACING_M,
  powerBoxTooWide,
  powerPositionKey,
  powerPylonMarks,
  powerPylonSpacingM,
  powerTowerIndex,
  substationRoleLabel,
  formatKilovolts,
  maxOsmVoltage,
  parseOsmVoltages,
  parseTowerHeightM,
  powerGridBoxKey,
  powerGridIncludesTowers,
  powerGridQuery,
  powerTierById,
  powerVoltageTier,
  projectPowerGrid,
  snapPowerGridBox,
  strokeIsUnderground,
  strokeLengthKm,
  validPowerGridBox,
} from './powerGridFeed.js';

/**
 * A real Overpass answer for 48.66,2.12 → 48.76,2.26 (the Saclay plateau, where
 * RTE's 400/225/90 kV Villejust yard sits), captured 2026-08-27 and trimmed to
 * one way per distinct `power`/`voltage` combination plus every substation and
 * a spread of pylons. © OpenStreetMap contributors, ODbL 1.0.
 */
const OSM = JSON.parse(readFileSync(
  new URL('./fixtures/power-grid-osm-sample.json', import.meta.url),
  'utf8',
));

const projected = projectPowerGrid(OSM);
/** The same projection, named for the tests below that read it as a document. */
const PAYLOAD = projectPowerGrid(OSM, { towersRequested: true });
const voltageOf = (record) => projected.voltages[record.vi];
const operatorOf = (record) => (record.o >= 0 ? projected.operators[record.o] : null);

test('the captured response still carries the fields the projection reads', () => {
  const strokes = OSM.elements.filter((e) => e.tags?.power === 'line' || e.tags?.power === 'cable');
  const substations = OSM.elements.filter((e) => e.tags?.power === 'substation');
  const towers = OSM.elements.filter((e) => e.tags?.power === 'tower' || e.tags?.power === 'portal');
  assert.ok(strokes.length >= 10 && substations.length >= 10 && towers.length >= 10);

  // `out geom` is what makes a stroke a route rather than an id.
  assert.ok(strokes.every((way) => Array.isArray(way.geometry) && way.geometry.length >= 2));
  assert.ok(strokes.every((way) => way.tags.voltage));
  // Trap 5: a relation yard has NO lat/lon of its own — only Overpass's center.
  const relation = substations.find((e) => e.type === 'relation');
  assert.ok(relation, 'the fixture must keep its multipolygon substation');
  assert.equal(relation.lat, undefined);
  assert.equal(relation.lon, undefined);
  assert.ok(Number.isFinite(relation.center?.lat) && Number.isFinite(relation.center?.lon));
});

// --- Trap 2: `voltage` is a `;` list carrying junk ---------------------------

test('parseOsmVoltages reads the `;` list instead of coercing it to NaN', () => {
  // Every one of these is a real captured value.
  assert.deepEqual(parseOsmVoltages('225000'), [225000]);
  assert.deepEqual(parseOsmVoltages('225000;63000'), [225000, 63000]);
  assert.deepEqual(parseOsmVoltages('400000;225000;90000'), [400000, 225000, 90000]);
  // Repeats collapse — a shared route carrying three 225 kV circuits is one
  // reading, not three.
  assert.deepEqual(parseOsmVoltages('225000;225000;225000;63000'), [225000, 63000]);
  // A zero token means a circuit that is not energised. Dropped, never counted.
  assert.deepEqual(parseOsmVoltages('225000;0'), [225000]);
  assert.deepEqual(parseOsmVoltages('63000;0'), [63000]);
  // Order in the tag is not order of magnitude.
  assert.deepEqual(parseOsmVoltages('90000;20000'), [90000, 20000]);
  assert.deepEqual(parseOsmVoltages('0;225000'), [225000]);

  // The failure this exists to prevent, stated outright.
  assert.ok(Number.isNaN(Number('225000;63000')));
  assert.equal(maxOsmVoltage('225000;63000'), 225000);

  // Nothing usable is NaN, not 0 — a 0 would read as "zero volts, mapped".
  for (const junk of ['', '  ', 'high', '400 kV', 'AC', null, undefined, '-225000', ';;']) {
    assert.ok(Number.isNaN(maxOsmVoltage(junk)), String(junk));
  }
});

test('every distinct voltage string in the captured box survives the projection', () => {
  const raw = new Set(
    OSM.elements
      .filter((e) => e.tags?.power === 'line' || e.tags?.power === 'cable')
      .map((e) => e.tags.voltage),
  );
  // The fixture was built to hold one way per distinct combination, so this is
  // the real spread: 63/90/225/400 kV plus the four list forms.
  assert.ok(raw.has('225000;0'));
  assert.ok(raw.has('225000;225000;225000;63000'));
  assert.ok(raw.has('63000;0'));
  for (const value of raw) {
    const entry = projected.voltages.find((v) => v.raw === value);
    assert.ok(entry, `voltage ${value} reached the payload`);
    assert.equal(entry.v, parseOsmVoltages(value)[0]);
  }
  // The `225000;0` route is a 225 kV route, and the whole string travels so the
  // card can show what OSM actually says.
  const zeroed = projected.voltages.find((v) => v.raw === '225000;0');
  assert.equal(zeroed.v, 225000);
  assert.equal(zeroed.tier, 'hv-high');
  assert.deepEqual(zeroed.all, [225000]);
});

// --- Trap 3: `power=line` is not a synonym for high voltage ------------------

test('the 50 kV floor is enforced numerically, not left to the Overpass regex', () => {
  const lowVoltage = {
    type: 'way',
    id: 1,
    // Real shape: `power=line` at four hundred VOLTS, live in the same city box.
    tags: { power: 'line', voltage: '400' },
    geometry: [{ lat: 48.7, lon: 2.2 }, { lat: 48.71, lon: 2.21 }],
  };
  const result = projectPowerGrid({ elements: [lowVoltage] });
  assert.equal(result.strokes.length, 0);
  assert.equal(result.stats.rejected.belowFloor, 1);

  // And the boundary itself: 50 kV is in, 49.9 kV is out.
  assert.equal(powerVoltageTier(POWER_GRID_MIN_VOLTAGE_V)?.id, 'hv-low');
  assert.equal(powerVoltageTier(POWER_GRID_MIN_VOLTAGE_V - 100), null);
  assert.equal(powerVoltageTier(NaN), null);

  // A mixed list clears the floor on its highest token, which is the point:
  // a 400 V service tapped off a 63 kV line is still a 63 kV line.
  assert.equal(powerVoltageTier(maxOsmVoltage('400;63000'))?.id, 'hv-low');
});

test('the prefilter regex admits exactly what the numeric floor admits', () => {
  const re = new RegExp(POWER_GRID_VOLTAGE_PREFILTER);
  const admits = (raw) => re.test(raw);
  for (const raw of ['63000', '90000', '150000', '225000', '400000', '50000', '765000',
    '225000;0', '90000;20000', '400000;225000;90000', '0;225000', '1000000']) {
    assert.ok(admits(raw), `prefilter keeps ${raw}`);
    assert.ok(powerVoltageTier(maxOsmVoltage(raw)), `floor keeps ${raw}`);
  }
  for (const raw of ['400', '20000', '25000', '15000', '20000;400', '1500', '49999']) {
    assert.equal(admits(raw), false, `prefilter drops ${raw}`);
    assert.equal(powerVoltageTier(maxOsmVoltage(raw)), null, `floor drops ${raw}`);
  }
});

test('voltage bands are ordered, contiguous, and read as an operator writes them', () => {
  const kv = POWER_GRID_TIERS.map((tier) => tier.minKv);
  assert.deepEqual(kv, [...kv].sort((a, b) => b - a));
  assert.equal(kv.at(-1), POWER_GRID_MIN_VOLTAGE_V / 1000);
  assert.equal(powerVoltageTier(400_000).id, 'ehv');
  assert.equal(powerVoltageTier(225_000).id, 'hv-high');
  assert.equal(powerVoltageTier(150_000).id, 'hv-mid');
  assert.equal(powerVoltageTier(90_000).id, 'hv-low');
  assert.equal(powerVoltageTier(63_000).id, 'hv-low');
  assert.equal(powerTierById('ehv').color, '#ff5f4d');
  assert.equal(powerTierById('nope'), null);

  assert.equal(formatKilovolts(400_000), '400 kV');
  assert.equal(formatKilovolts(63_000), '63 kV');
  assert.equal(formatKilovolts(1_500), '1.5 kV');
  assert.equal(formatKilovolts(NaN), '—');
});

// --- Trap 4: the substation subtype is a caption, never a filter -------------

test('an industrial-tagged RTE yard is kept, and a subtype-less one is too', () => {
  const byRef = new Map(projected.substations.map((s) => [s.ref, s]));

  // Real: 225 kV, operator RTE, `substation=industrial`. A transmission-only
  // filter would have deleted it.
  const villeras = byRef.get('VLERA');
  assert.equal(villeras.name, 'Poste électrique de Villeras');
  assert.equal(villeras.role, 'industrial');
  assert.equal(voltageOf(villeras).v, 225_000);
  assert.equal(operatorOf(villeras), 'RTE');

  // Real: no `substation` tag at all, 90 kV, operator RTE.
  const provence = byRef.get('PROVE');
  assert.equal(provence.role, null);
  assert.equal(provence.roleLabel, POWER_SUBSTATION_ROLE_UNSTATED);
  assert.equal(voltageOf(provence).v, 90_000);

  // Real: the thing this layer is actually about, named as such upstream.
  const saclay = byRef.get('SACL5');
  assert.equal(saclay.name, 'Poste source Enedis');
  assert.equal(saclay.roleLabel, 'Poste source (HV → distribution)');

  // Real: a railway traction substation, 225 kV stepping to 25 kV. Kept and
  // LABELLED, because a traction feed is part of the grid but is not a poste
  // source and the card must not say it is.
  const carres = byRef.get('CARR5');
  assert.equal(carres.roleLabel, 'Railway traction substation');
  assert.equal(operatorOf(carres), 'SNCF Réseau');
  assert.deepEqual(voltageOf(carres).all, [225_000, 25_000]);

  // A subtype this table has never seen is REPEATED rather than flattened into
  // "not stated" — OSM did say something. Live case, central London: a yard
  // tagged `minor_distribution` carrying a mapped 132 kV. Voltage is the
  // evidence, so it is drawn; the label does not promote it or hide the
  // disagreement.
  assert.equal(substationRoleLabel('minor_distribution'), 'Tagged minor distribution, at high voltage');
  assert.equal(substationRoleLabel('some_future_value'), 'Tagged some future value');
  assert.equal(substationRoleLabel(''), POWER_SUBSTATION_ROLE_UNSTATED);
  assert.equal(substationRoleLabel(null), POWER_SUBSTATION_ROLE_UNSTATED);
  assert.equal(substationRoleLabel('TRANSMISSION'), 'Transmission substation');

  // Every role in the box is reported, so the legend can never round a
  // traction feed into the poste-source count.
  assert.ok(projected.stats.byRole.traction >= 1);
  assert.ok(projected.stats.byRole.industrial >= 1);
  assert.ok(projected.stats.byRole.unstated >= 1);
  assert.equal(
    Object.values(projected.stats.byRole).reduce((a, b) => a + b, 0),
    projected.substations.length,
  );
});

// --- Trap 5: a relation yard is positionless without `center` ----------------

test('a multipolygon substation is placed from `center`, not dropped', () => {
  const hauteBorne = projected.substations.find((s) => s.name === 'Poste électrique de Haute-Borne');
  assert.ok(hauteBorne, 'the relation yard reached the payload');
  assert.equal(hauteBorne.id.startsWith('r'), true);
  assert.ok(Math.abs(hauteBorne.lat - 49.0499) < 0.001);
  assert.ok(Math.abs(hauteBorne.lon - 2.14785) < 0.001);
  assert.equal(hauteBorne.roleLabel, 'Transmission substation');

  // And a substation with neither is refused rather than placed at 0,0.
  const nowhere = projectPowerGrid({
    elements: [{ type: 'relation', id: 9, tags: { power: 'substation', voltage: '225000' } }],
  });
  assert.equal(nowhere.substations.length, 0);
  assert.equal(nowhere.stats.rejected.noPosition, 1);
});

// --- Trap 6: the underground half of the same network ------------------------

test('underground strokes are separated by `location`, with the key as fallback', () => {
  const cables = projected.strokes.filter((s) => s.u === 1);
  assert.ok(cables.length >= 3, 'the captured box holds underground cable');
  assert.ok(projected.stats.undergroundKm > 0);
  assert.equal(
    Number((projected.stats.overheadKm + projected.stats.undergroundKm).toFixed(1)),
    projected.stats.lengthKm,
  );

  // The mapped answer wins in BOTH directions, including the mistagged cases.
  assert.equal(strokeIsUnderground({ power: 'cable', location: 'underground' }), true);
  assert.equal(strokeIsUnderground({ power: 'line', location: 'underground' }), true);
  assert.equal(strokeIsUnderground({ power: 'cable', location: 'overhead' }), false);
  // Silent `location`: the key carries the convention and nothing more.
  assert.equal(strokeIsUnderground({ power: 'cable' }), true);
  assert.equal(strokeIsUnderground({ power: 'line' }), false);
  assert.equal(strokeIsUnderground({}), false);
});

// --- Trap 1: one cap per class, because a shared cap starves the tail --------

test('the query gives every class its own bounded output statement', () => {
  const box = { south: 48.66, west: 2.12, north: 48.76, east: 2.26 };
  const ql = powerGridQuery(box, { towers: true });

  // Four bounded selectors, five outputs, each with its own cap.
  assert.match(ql, /way\["power"~"\^\(line\|cable\)\$"\]/);
  assert.match(ql, /way\["power"="substation"\]/);
  assert.match(ql, /node\["power"="substation"\]/);
  assert.match(ql, /relation\["power"="substation"\]/);
  assert.match(ql, new RegExp(`\\.s out geom ${POWER_GRID_CAPS.strokes};`));
  assert.match(ql, new RegExp(`\\.pw out center tags ${POWER_GRID_CAPS.substationWays};`));
  assert.match(ql, new RegExp(`\\.pn out tags ${POWER_GRID_CAPS.substationNodes};`));
  assert.match(ql, new RegExp(`\\.pr out center tags ${POWER_GRID_CAPS.substationRelations};`));
  assert.match(ql, new RegExp(`\\.t out body ${POWER_GRID_CAPS.towers};`));

  // The failure being prevented: ONE union with ONE cap. Overpass emits
  // node → way → relation, so towers would consume the whole budget and no
  // line or substation would come back at all.
  assert.equal(/\(way.*;node.*;\);out/.test(ql), false);

  // Every selector is spatially bounded by the same bbox, four times over.
  const bbox = '48.660000,2.120000,48.760000,2.260000';
  assert.equal(ql.split(bbox).length - 1, 5);
  assert.match(ql, /^\[out:json\]\[timeout:\d+\];/);

  // Caps are clamped, so a caller cannot ask a public mirror for the planet.
  const huge = powerGridQuery(box, { caps: { ...POWER_GRID_CAPS, strokes: 10 ** 9 }, towers: false });
  assert.match(huge, /\.s out geom 6000;/);
  assert.equal(huge.includes('power"~"^(tower|portal)$"'), false);
});

test('saturation is reported per class, from the caps the query actually used', () => {
  const caps = {
    strokes: 4, substationWays: 2, substationNodes: 1, substationRelations: 1, towers: 3,
  };
  const saturating = projectPowerGrid(OSM, { caps });
  assert.equal(saturating.saturated.strokes, true);
  assert.equal(saturating.saturated.substations, true);
  assert.equal(saturating.saturated.towers, true);
  assert.deepEqual(saturating.caps, caps);

  // The real caps against the real box: nothing truncated, so nothing claimed.
  assert.deepEqual(projected.saturated, { strokes: false, substations: false, towers: false });

  // Towers that were never requested cannot be "truncated".
  const noTowers = projectPowerGrid(OSM, { caps: { ...caps, towers: 1 }, towersRequested: false });
  assert.equal(noTowers.saturated.towers, false);
  assert.equal(noTowers.towersRequested, false);
});

// --- Geometry, dictionaries, and the arithmetic on the legend ---------------

test('a stroke is the mapped way, rounded to 1.1 m and decimated by nothing', () => {
  const source = OSM.elements
    .filter((e) => e.tags?.power === 'line' || e.tags?.power === 'cable')
    .sort((a, b) => b.geometry.length - a.geometry.length)[0];
  const stroke = projected.strokes.find((s) => s.id === `w${source.id}`);
  assert.ok(stroke, 'the longest captured way reached the payload');
  // Vertex for vertex — the projection never simplifies published geometry.
  assert.equal(stroke.c.length, source.geometry.length * 2);
  for (let i = 0; i < source.geometry.length; i += 1) {
    assert.ok(Math.abs(stroke.c[i * 2] - source.geometry[i].lon) <= 5e-6);
    assert.ok(Math.abs(stroke.c[i * 2 + 1] - source.geometry[i].lat) <= 5e-6);
    // Five decimals, no more: the published precision, stated once.
    assert.equal(stroke.c[i * 2], Number(stroke.c[i * 2].toFixed(5)));
  }

  // A one-vertex remnant is a point, not a route.
  const clipped = projectPowerGrid({
    elements: [{
      type: 'way', id: 3, tags: { power: 'line', voltage: '225000' },
      geometry: [{ lat: 48.7, lon: 2.2 }],
    }],
  });
  assert.equal(clipped.strokes.length, 0);
  assert.equal(clipped.stats.rejected.noGeometry, 1);
});

test('stroke length is great-circle and totals match the per-tier roll-up', () => {
  // One degree of latitude at the meridian ≈ 111.19 km.
  assert.ok(Math.abs(strokeLengthKm([0, 0, 0, 1]) - 111.19) < 0.05);
  assert.equal(strokeLengthKm([0, 0]), 0);
  assert.equal(strokeLengthKm(null), 0);

  const tierKm = projected.tiers.reduce((sum, tier) => sum + tier.lengthKm, 0);
  assert.ok(Math.abs(tierKm - projected.stats.lengthKm) < 0.5);
  const tierStrokes = projected.tiers.reduce((sum, tier) => sum + tier.strokes, 0);
  assert.equal(tierStrokes, projected.strokes.length);
  const tierSubs = projected.tiers.reduce((sum, tier) => sum + tier.substations, 0);
  assert.equal(tierSubs, projected.substations.length);
  // Bands appear in fixed order, so the legend never reshuffles between pans.
  const order = POWER_GRID_TIERS.map((t) => t.id);
  assert.deepEqual(projected.tiers.map((t) => t.id), order.filter(
    (id) => projected.tiers.some((t) => t.id === id),
  ));
});

test('operators, route names and voltages are interned, and absence is -1', () => {
  assert.ok(projected.operators.includes('RTE'));
  assert.ok(projected.operators.length <= 6, 'a handful of operators, not one per element');
  // Every index resolves; -1 means the tag was absent and nothing is invented.
  for (const record of [...projected.strokes, ...projected.substations, ...projected.towers]) {
    assert.ok(record.o === -1 || typeof projected.operators[record.o] === 'string');
  }
  for (const stroke of projected.strokes) {
    assert.ok(stroke.n === -1 || typeof projected.routes[stroke.n] === 'string');
    assert.ok(projected.voltages[stroke.vi]);
  }
  // OSM splits one named liaison across many ways, so the honest "how many
  // lines" answer is the distinct route count, not the stroke count.
  assert.equal(projected.stats.routes, projected.routes.length);
  assert.ok(projected.stats.routes <= projected.stats.strokes);

  const anonymous = projectPowerGrid({
    elements: [{
      type: 'way', id: 4, tags: { power: 'line', voltage: '400000' },
      geometry: [{ lat: 48.7, lon: 2.2 }, { lat: 48.71, lon: 2.21 }],
    }],
  });
  assert.equal(anonymous.strokes[0].o, -1);
  assert.equal(anonymous.strokes[0].n, -1);
  assert.deepEqual(anonymous.operators, []);
});

test('a pylon keeps its mapped height and refuses to guess one', () => {
  assert.ok(projected.towers.length >= 10);
  const withHeight = projected.towers.filter((t) => Number.isFinite(t.h));
  assert.ok(withHeight.length >= 1, 'the captured box maps some pylon heights');
  assert.ok(withHeight.every((t) => t.h > 0 && t.h <= 300));
  // Unmapped is null, never a prior — a pylon is drawn on the ground either way.
  assert.ok(projected.towers.some((t) => t.h === null));
  assert.ok(projected.towers.some((t) => t.portal === 1), 'portals are kept');

  assert.equal(parseTowerHeightM('35'), 35);
  assert.equal(parseTowerHeightM('41 m'), 41);
  for (const junk of ['', 'tall', '12\'6"', '0', '-5', '500', '30-40']) {
    assert.ok(Number.isNaN(parseTowerHeightM(junk)), String(junk));
  }
});

// --- Box handling ------------------------------------------------------------

test('a box is validated, snapped outward, and keyed at the query precision', () => {
  assert.deepEqual(
    validPowerGridBox({ south: '48.6', west: '2.1', north: '48.7', east: '2.3' }),
    { south: 48.6, west: 2.1, north: 48.7, east: 2.3 },
  );
  // Unordered, dateline-crossing, out-of-range, and oversized are all refused.
  assert.equal(validPowerGridBox({ south: 48.7, west: 2.1, north: 48.6, east: 2.3 }), null);
  assert.equal(validPowerGridBox({ south: 48.6, west: 179, north: 48.7, east: -179 }), null);
  assert.equal(validPowerGridBox({ south: -91, west: 2.1, north: 48.7, east: 2.3 }), null);
  assert.equal(validPowerGridBox({
    south: 48, west: 2, north: 48 + POWER_GRID_MAX_BOX_DEG + 0.01, east: 2.3,
  }), null);
  assert.equal(validPowerGridBox(null), null);

  // A box whose span IS the limit must be accepted. In binary floating point
  // 2.85 − 2.05 is 0.8000000000000003, so a bare `>` refused exactly the box the
  // limit describes — caught against the live proxy on the widest box a client
  // can ask for.
  assert.ok(2.85 - 2.05 > POWER_GRID_MAX_BOX_DEG, 'the floating-point hair is real');
  assert.ok(validPowerGridBox({ south: 48.6, west: 2.05, north: 49.4, east: 2.85 }));
  assert.equal(powerBoxTooWide({ south: 48.6, west: 2.05, north: 49.4, east: 2.85 }), false);
  // The tolerance is a hair, not a loophole: a metre over is still over.
  assert.equal(powerBoxTooWide({
    south: 48.6, west: 2.05, north: 48.6 + POWER_GRID_MAX_BOX_DEG + 0.00001, east: 2.85,
  }), true);

  // The snap only ever GROWS, so a cached answer always covers what was asked.
  const raw = { south: 48.612, west: 2.117, north: 48.749, east: 2.263 };
  const snapped = snapPowerGridBox(raw);
  assert.ok(snapped.south <= raw.south && snapped.west <= raw.west);
  assert.ok(snapped.north >= raw.north && snapped.east >= raw.east);
  // Neighbouring viewports land on the SAME cell, which is what makes a pan cheap.
  assert.equal(
    powerGridBoxKey(snapped),
    powerGridBoxKey(snapPowerGridBox({
      south: 48.618, west: 2.122, north: 48.741, east: 2.259,
    })),
  );
  // Floating point must not push an exact grid line a whole cell out.
  assert.deepEqual(snapPowerGridBox({ south: 48.6, west: 2.1, north: 48.7, east: 2.3 }), {
    south: 48.6, west: 2.1, north: 48.7, east: 2.3,
  });
});

test('pylons are asked for only when the box is tight enough to tell them apart', () => {
  const tight = { south: 48.7, west: 2.2, north: 48.8, east: 2.3 };
  const wide = { south: 48.2, west: 2.0, north: 48.8, east: 2.6 };
  assert.equal(powerGridIncludesTowers(tight), true);
  assert.equal(powerGridIncludesTowers(wide), false);
  assert.ok(POWER_GRID_TOWER_MAX_BOX_DEG < POWER_GRID_MAX_BOX_DEG);
  assert.equal(powerGridQuery(wide).includes('tower'), false);
  assert.equal(powerGridQuery(tight).includes('tower'), true);
});

test('a pylon is drawn on a MAPPED vertex, and the spacing only ever skips one', () => {
  // The rhythm the operator asked for — "en poser une tous les X mètres" — with
  // the constraint the layer cannot break: no mark may sit at a coordinate
  // nobody surveyed. Dividing a 12 km line into six 2 km pieces would put five
  // pylons in fields. Walking the way's own node list and skipping until the
  // spacing is met puts every one of them on a node.
  const vertices = new Set();
  for (const stroke of PAYLOAD.strokes) {
    if (stroke.u) continue;
    for (let i = 0; i < stroke.c.length; i += 2) {
      vertices.add(powerPositionKey(stroke.c[i + 1], stroke.c[i]));
    }
  }
  const marks = powerPylonMarks(PAYLOAD, { spacingM: 500 });
  assert.ok(marks.length > 0);
  for (const mark of marks) {
    assert.ok(vertices.has(powerPositionKey(mark.lat, mark.lon)),
      'every mark sits on a vertex of an overhead mapped way');
  }
});

test('an underground cable gets no pylons, however many vertices it carries', () => {
  // Not a refinement — the whole reason the layer dashes them. A trench follows
  // streets, so it carries MORE vertices than the overhead line beside it;
  // without this filter the densest pylon field on screen would be laid exactly
  // where there are none.
  const undergroundOnly = { ...PAYLOAD, strokes: PAYLOAD.strokes.filter((s) => s.u) };
  assert.ok(undergroundOnly.strokes.length > 0, 'the fixture really has cable in it');
  assert.deepEqual(powerPylonMarks(undergroundOnly, { spacingM: 100 }), []);
});

test('the spacing holds ACROSS ways, so a junction does not grow a rosette', () => {
  // OpenStreetMap splits a liaison at every junction, and two consecutive ways
  // SHARE their junction node. "The first vertex of every way" alone stacks two
  // pylons on one coordinate at every split.
  const marks = powerPylonMarks(PAYLOAD, { spacingM: 800 });
  const seen = new Set();
  for (const mark of marks) {
    const key = powerPositionKey(mark.lat, mark.lon);
    assert.equal(seen.has(key), false, `two pylons drawn on ${key}`);
    seen.add(key);
  }
  // And no two marks are closer than the spacing, whichever ways they came from.
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const dLat = (marks[i].lat - marks[j].lat) * 111_320;
      const dLon = (marks[i].lon - marks[j].lon) * 111_320
        * Math.cos(marks[i].lat * (Math.PI / 180));
      assert.ok(Math.hypot(dLat, dLon) >= 800 * 0.98,
        'two marks closer together than the spacing asked for');
    }
  }
});

test('climbing thins the pylons and descending walks back down to every vertex', () => {
  const tight = powerPylonMarks(PAYLOAD, { spacingM: POWER_PYLON_MIN_SPACING_M });
  const wide = powerPylonMarks(PAYLOAD, { spacingM: 8_000 });
  assert.ok(tight.length > wide.length,
    'a wider spacing must draw fewer pylons, not the same ones further apart');
  // The cap is a ceiling on the drawing, never a truncation of the data.
  assert.ok(powerPylonMarks(PAYLOAD, { spacingM: 10, maxCount: 12 }).length <= 12);
  assert.deepEqual(powerPylonMarks(PAYLOAD, { maxCount: 0 }), []);
  assert.deepEqual(powerPylonMarks(null), []);
});

test('the spacing is solved from the camera and clamped into a readable band', () => {
  // 44 px between two 17 px glyphs: a line of pylons rather than a dotted rule.
  assert.equal(powerPylonSpacingM(10), 10 * POWER_PYLON_GAP_PX);
  // A camera on the deck must not ask for a 3 m spacing, and one in orbit must
  // not ask for a 400 km one.
  assert.equal(powerPylonSpacingM(0.01), POWER_PYLON_MIN_SPACING_M);
  assert.equal(powerPylonSpacingM(100_000), POWER_PYLON_MAX_SPACING_M);
  assert.equal(powerPylonSpacingM(NaN), POWER_PYLON_MIN_SPACING_M);
  assert.equal(powerPylonSpacingM(-5), POWER_PYLON_MIN_SPACING_M);
});

test('a mapped pylon is found by its EXACT position, because it IS the way vertex', () => {
  // A tower node and a way vertex are the same OSM node, published at the same
  // 1.1 m precision, so the card join is an exact-key lookup rather than a
  // nearest-neighbour search — and a MISS therefore means something: no drawn
  // way passes through that pylon.
  //
  // This fixture cannot measure the join RATE and must not pretend to: it was
  // trimmed to one way per distinct power/voltage combination, so most of the
  // ways its towers belong to are not in it. The rate is measured against the
  // live proxy and recorded in `powerPylonMarks` — 574/574 at Bayonne, 750/775
  // at Saclay. What this pins is the INDEX: every tower reachable by its own
  // coordinate, and no tower reachable by a neighbouring one.
  const index = powerTowerIndex(PAYLOAD);
  assert.equal(index.size, PAYLOAD.towers.length);
  for (const tower of PAYLOAD.towers) {
    assert.equal(index.get(powerPositionKey(tower.lat, tower.lon)), tower);
    // One metre away is a different node, not a fuzzy match on the same one.
    assert.equal(index.get(powerPositionKey(tower.lat + 0.0001, tower.lon)), undefined);
  }

  // And the join really does fire where the fixture DOES carry both halves:
  // a mark that lands on a tagged tower gets the pylon record, and the rest
  // stay way vertices rather than being promoted into pylons.
  const marks = powerPylonMarks(PAYLOAD, { spacingM: 150 });
  const joined = marks.filter((mark) => index.has(powerPositionKey(mark.lat, mark.lon)));
  assert.ok(joined.length > 0, 'the fixture must exercise the join at least once');
  assert.ok(joined.length < marks.length,
    'and it must exercise the un-tagged case too, which is the honest card');
});

test('a casing is wider than every band it sits under', () => {
  // The fix for "c'est quasi invisible": a coloured line on an orthophoto has
  // no reliable background, so every stroke is drawn twice — near-black and
  // wider underneath, then its band colour on top.
  assert.ok(POWER_GRID_CASING_PX > 0);
  for (const tier of POWER_GRID_TIERS) {
    assert.ok(tier.widthPx >= 3, `${tier.id} must survive an orthophoto at 1:1`);
    assert.ok(tier.widthPx + POWER_GRID_CASING_PX > tier.widthPx);
  }
  // Ordered, so a 400 kV route still reads as the heaviest thing on screen.
  const widths = POWER_GRID_TIERS.map((tier) => tier.widthPx);
  assert.deepEqual(widths, [...widths].sort((a, b) => b - a));
});

test('a switchyard jumper is not a line, and earns no pylon', () => {
  // Measured 2026-09-14 over the Trocadéro: 126 km of mapped grid, 100% of it
  // underground, and 33 ways still tagged `power=line` — of 3 to 45 m each,
  // 499 m in total. Those are the jumpers inside a substation yard. A pylon
  // glyph on one is a pylon drawn in the middle of a switchyard.
  const yardJumper = {
    id: 'w1', c: [2.29, 48.85, 2.2901, 48.8501], km: 0.012, u: 0, vi: 0, n: -1, o: -1,
  };
  const realLine = {
    id: 'w2', c: [2.10, 48.70, 2.12, 48.71, 2.14, 48.72], km: 3.1, u: 0, vi: 0, n: -1, o: -1,
  };
  const voltages = [{ v: 225_000, raw: '225000', tier: 'hv-high', all: [225_000] }];
  assert.deepEqual(powerPylonMarks({ strokes: [yardJumper], voltages }, { spacingM: 150 }), []);
  assert.ok(powerPylonMarks({ strokes: [realLine], voltages }, { spacingM: 150 }).length > 0,
    'and a real span is never excluded by the same threshold');
  // The threshold sits under the shortest real span and far over a yard run.
  assert.ok(POWER_PYLON_MIN_WAY_M < 300, 'a French 400 kV span is 300-500 m');
  assert.ok(POWER_PYLON_MIN_WAY_M > 45, 'the longest yard jumper measured was 45 m');
});
