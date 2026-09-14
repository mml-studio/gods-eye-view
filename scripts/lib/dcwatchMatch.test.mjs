import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  DCWATCH_MATCH_RADIUS_M,
  identityTokens,
  matchDcwatchToOsm,
  metresBetween,
  normalise,
  parseCsv,
  pointInGeometry,
  refNumbers,
  refsContradict,
} from './dcwatchMatch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('normalise folds accents, case and punctuation', () => {
  assert.equal(normalise('Adista Saint-Étienne'), 'adista saint etienne');
  assert.equal(normalise('  OVHCloud  RBX-2 '), 'ovhcloud rbx 2');
  assert.equal(normalise(null), '');
});

test('identityTokens drops the words that describe every datacenter', () => {
  const tokens = identityTokens('Datacenter Colt Paris Sud');
  assert.ok(tokens.has('colt'), 'the operator survives');
  assert.ok(!tokens.has('datacenter'), 'the category does not');
  assert.ok(!tokens.has('sud'), 'nor does a bearing');
});

test('identityTokens drops the caller-supplied city on both sides', () => {
  // The whole reason COGENT STRASBOURG once matched a machine-tool firm called
  // Quiri: 'strasbourg' was the only token the two had in common.
  const left = identityTokens('Cogent Communications Strasbourg', ['STRASBOURG']);
  const right = identityTokens('Quiri Strasbourg', ['STRASBOURG']);
  assert.deepEqual([...left].filter((t) => right.has(t)), []);
});

test('identityTokens maps operator aliases onto one key', () => {
  assert.ok(identityTokens('Interxion (a Digital Realty Company)').has('digitalrealty'));
  assert.ok(identityTokens('SFR Netcenter').has('ultraedge'), 'SFR sold its estate to UltraEdge');
  assert.ok(identityTokens('OVHCloud').has('ovh'));
});

test('refNumbers reads a building index and its stem', () => {
  assert.deepEqual([...(refNumbers('OVHCloud RBX-2').get('rbx') ?? [])], [2]);
  assert.deepEqual([...(refNumbers('OVHcloud Roubaix - RBX6').get('rbx') ?? [])], [6]);
  assert.deepEqual([...(refNumbers('Telehouse 2').get('telehouse') ?? [])], [2]);
  assert.deepEqual([...(refNumbers('Digital Realty MRS1').get('mrs') ?? [])], [1]);
});

test('refNumbers ignores stems that name a category rather than a hall', () => {
  // 'DC01' indexes nothing a reader can check, and the 4 in DATA4 is a company.
  assert.equal(refNumbers('DATA4 DC01').size, 0);
});

test('refsContradict refuses two halls of one campus, tolerates silence', () => {
  assert.equal(refsContradict('OVHCloud RBX-2', 'OVHcloud Roubaix - RBX6'), true);
  assert.equal(refsContradict('OVHCloud RBX-2', 'OVHcloud Roubaix - RBX2'), false);
  // An OSM feature that names no ref is not disagreeing, it is saying nothing.
  assert.equal(refsContradict('OVHCloud RBX-2', 'OVHcloud Roubaix'), false);
  // Different stems are different vocabularies, not a contradiction.
  assert.equal(refsContradict('COLT PAR 5', 'Colt Paris 3'), false);
});

test('metresBetween is metric at French latitudes', () => {
  // 0.001° of latitude is 111.3 m anywhere.
  assert.ok(Math.abs(metresBetween([2.35, 48.85], [2.35, 48.851]) - 111.3) < 1);
});

test('pointInGeometry answers for polygons and refuses points', () => {
  const square = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  assert.equal(pointInGeometry([0.5, 0.5], square), true);
  assert.equal(pointInGeometry([1.5, 0.5], square), false);
  assert.equal(pointInGeometry([0.5, 0.5], { type: 'Point', coordinates: [0.5, 0.5] }), false);
});

test('matchDcwatchToOsm distributes a campus instead of collapsing it', () => {
  // Six halls inside 150 m of each other, the exact shape that made plain
  // nearest-neighbour hand RBX-2's five megawatts to RBX6.
  const halls = [2, 3, 4, 5, 6, 7];
  const features = halls.map((n, i) => ({
    centre: [2.0 + i * 0.0005, 50.7],
    identity: `OVHcloud Roubaix - RBX${n}`,
    ref: `OVHcloud Roubaix - RBX${n}`,
  }));
  // Rows arrive in a different order and each one is nearest to the WRONG hall.
  const rows = halls.slice().reverse().map((n, i) => ({
    point: [2.0 + i * 0.0005, 50.7],
    identity: `OVHCloud RBX-${n}`,
    city: 'ROUBAIX',
    ref: `OVHCloud RBX-${n}`,
  }));

  const { pairs, unmatchedRows } = matchDcwatchToOsm(rows, features);
  assert.equal(pairs.length, 6);
  assert.equal(unmatchedRows.length, 0);
  for (const pair of pairs) {
    assert.equal(rows[pair.rowIndex].ref.match(/\d+$/)[0], features[pair.featureIndex].ref.match(/\d+$/)[0]);
  }
});

test('matchDcwatchToOsm refuses a neighbour that only shares a city', () => {
  const features = [{ centre: [3.18, 50.69], identity: 'OVHcloud Roubaix - RBX4', ref: 'RBX4' }];
  const rows = [{
    point: [3.1801, 50.69], identity: 'Civicos Networking Roubaix', city: 'ROUBAIX', ref: 'Civicos Networking Roubaix',
  }];
  const { pairs, unmatchedRows } = matchDcwatchToOsm(rows, features);
  assert.equal(pairs.length, 0);
  assert.deepEqual(unmatchedRows, [0]);
});

test('matchDcwatchToOsm keeps a pin inside the polygon at any offset', () => {
  const features = [{
    centre: [2.5, 48.9],
    geometry: { type: 'Polygon', coordinates: [[[2.49, 48.89], [2.49, 48.91], [2.51, 48.91], [2.51, 48.89], [2.49, 48.89]]] },
    identity: 'Equinix PA2',
    ref: 'Equinix PA2',
  }];
  const rows = [{ point: [2.495, 48.895], identity: 'Equinix, Inc PA2', city: 'PARIS', ref: 'PA2' }];
  const { pairs } = matchDcwatchToOsm(rows, features);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].metres, 0);
});

test('matchDcwatchToOsm honours the radius', () => {
  const features = [{ centre: [2.5, 48.9], identity: 'Colt', ref: 'Colt' }];
  const far = [{ point: [2.51, 48.9], identity: 'Colt Technology', city: 'PARIS', ref: 'Colt' }];
  assert.ok(metresBetween([2.5, 48.9], [2.51, 48.9]) > DCWATCH_MATCH_RADIUS_M);
  assert.equal(matchDcwatchToOsm(far, features).pairs.length, 0);
  assert.equal(matchDcwatchToOsm(far, features, { radiusM: 2000 }).pairs.length, 1);
});

test('parseCsv handles the quoted commas the DCWatch addresses carry', () => {
  const rows = parseCsv('a,b\n1,"rue des Lilas, 91000 Évry"\n2,plain\n');
  assert.deepEqual(rows, [
    { a: '1', b: 'rue des Lilas, 91000 Évry' },
    { a: '2', b: 'plain' },
  ]);
});

test('the vendored DCWatch snapshot still has the columns this build reads', () => {
  const rows = parseCsv(readFileSync(resolve(ROOT, 'src/data/local_data/datacenters/dcwatch/export_summary.csv'), 'utf8'));
  assert.ok(rows.length > 400, `expected the full export, got ${rows.length} rows`);
  for (const column of ['name', 'latitude', 'longitude', 'city_name', 'country', 'power_total_mw', 'operation_start_year', 'progress_step', 'operator']) {
    assert.ok(column in rows[0], `missing column ${column}`);
  }
  const french = rows.filter((r) => r.country === 'France');
  assert.ok(french.length > 400, `expected 400+ French rows, got ${french.length}`);
  const withPower = french.filter((r) => Number(r.power_total_mw) > 0);
  assert.ok(withPower.length / french.length > 0.9, 'power coverage fell below 90 %');
});

test('the two DCWatch surface columns are derived, and must stay out of the pack', () => {
  // This is the assertion that keeps a future contributor from "completing"
  // the card with a floor area: three quarters of the pairs are one number and
  // a constant, and a sixth of them are that constant applied backwards.
  const rows = parseCsv(readFileSync(resolve(ROOT, 'src/data/local_data/datacenters/dcwatch/export_summary.csv'), 'utf8'))
    .filter((r) => r.country === 'France');
  let both = 0;
  let exact = 0;
  for (const row of rows) {
    const total = Number(row.total_floor_area_sqm);
    const it = Number(row.IT_floor_area_sqm);
    if (!(total > 0) || !(it > 0)) continue;
    both += 1;
    const ratio = (it / total).toFixed(3);
    if (ratio === '0.500' || ratio === '5.000') exact += 1;
  }
  assert.ok(both > 300, `expected 300+ rows carrying both areas, got ${both}`);
  assert.ok(exact / both > 0.7, `only ${((100 * exact) / both).toFixed(1)} % are an exact 0.5/5.0 ratio — re-check whether the columns became real measurements`);

  const pack = readFileSync(resolve(ROOT, 'src/data/local_data/datacenters/datacenters.geojsonl'), 'utf8');
  assert.ok(!pack.includes('floorAreaM2'), 'the derived floor area leaked into the pack');
  assert.ok(!pack.includes('itAreaM2'), 'the derived IT area leaked into the pack');
});
