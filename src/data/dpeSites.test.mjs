// src/data/dpeSites.test.mjs
//
// Four questions, in the order they can make the map lie:
//
//   1. is a diagnostic grouped under the thing it is actually about — the
//      building the register NAMES, then the address, then a bare coordinate —
//      and is every served row still there afterwards;
//   2. does the propagation stop where the register stops agreeing: an address
//      whose rows name TWO buildings must lend neither;
//   3. does a badge stand INSIDE the shape it describes, including for the
//      shapes whose centroid is outside them;
//   4. does a site say HOW it was placed, differently for a record and for a
//      deduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DPE_SITE_MAX,
  dpeBuildingSummary,
  dpeGradeOf,
  dpeSitePlacementLine,
  geometryParts,
  groupDpeSites,
  partsAnchor,
  unanimousRnbByAddress,
} from './dpeSites.js';

/** One ADEME row as `projectDpe` shapes it, cut to what grouping reads. */
function row(id, {
  letter = 'D', ban = null, rnb = null, lon = 2.3760, lat = 48.8300, distanceM = 40,
} = {}) {
  return {
    id,
    etiquetteDpe: letter,
    banId: ban,
    rnb,
    address: ban ? `${ban} rue de la Mesure` : null,
    lon,
    lat,
    distanceM,
  };
}

/* ── 1. what a site is ─────────────────────────────────────────────────── */

test('the register naming a building outranks the address it was geocoded to', () => {
  const sites = groupDpeSites([
    row('a', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('b', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('c', { ban: 'ban-2' }),
  ]);
  assert.equal(sites.length, 2);
  const building = sites.find((site) => site.key === 'rnb:RNB-A');
  assert.equal(building.kind, 'building');
  assert.equal(building.points.length, 2);
  assert.equal(sites.find((site) => site.key === 'ban:ban-2').kind, 'address');
});

test('grouping draws fewer marks and never drops a diagnostic', () => {
  // The measured shape of a Paris 13e scan, in miniature: forty-two rows on one
  // address, and the layer used to draw forty-two billboards on one pixel.
  const rows = Array.from({ length: 42 }, (_, i) => row(`r${i}`, { ban: 'ban-1' }));
  rows.push(row('other', { ban: 'ban-2' }));
  const sites = groupDpeSites(rows);
  assert.equal(sites.length, 2, 'two addresses, two marks');
  assert.equal(sites.reduce((sum, site) => sum + site.points.length, 0), 43);
  assert.equal(sites.find((site) => site.key === 'ban:ban-1').summary.total, 42);
});

test('a row with neither key is its own site, and one with no coordinate is still counted', () => {
  const sites = groupDpeSites([
    row('a', { lon: 2.1, lat: 48.1 }),
    row('b', { lon: 2.1, lat: 48.1 }),
    row('c', { lon: 2.2, lat: 48.2 }),
    row('d', { lon: null, lat: null }),
  ]);
  assert.equal(sites.length, 3, 'two coordinates, plus the one with none');
  const unplaced = sites.find((site) => site.key === 'pt:none');
  assert.equal(unplaced.points.length, 1);
  assert.equal(unplaced.lon, null, 'nothing is sent to the Gulf of Guinea');
});

test('sites come back nearest-first, and the ones the register could not place go last', () => {
  const sites = groupDpeSites([
    row('far', { ban: 'far', distanceM: 180 }),
    row('near', { ban: 'near', distanceM: 12 }),
    row('unknown', { ban: 'unknown', distanceM: null }),
  ]);
  assert.deepEqual(sites.map((site) => site.key), ['ban:near', 'ban:far', 'ban:unknown']);
});

/* ── 2. the propagation, and its refusal ───────────────────────────────── */

test('an address whose rows agree lends its building id to the rows that carry none', () => {
  const rows = [
    row('a', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('b', { ban: 'ban-1' }),
    row('c', { ban: 'ban-1' }),
  ];
  assert.deepEqual([...unanimousRnbByAddress(rows)], [['ban-1', 'RNB-A']]);
  const sites = groupDpeSites(rows);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].key, 'rnb:RNB-A');
  assert.equal(sites[0].points.length, 3, 'all three, not just the one that named it');
});

test('an address that names TWO buildings lends neither — that is the whole rule', () => {
  const rows = [
    row('a', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('b', { ban: 'ban-1', rnb: 'RNB-B' }),
    row('c', { ban: 'ban-1' }),
  ];
  assert.equal(unanimousRnbByAddress(rows).size, 0, 'a courtyard behind a street building');
  const sites = groupDpeSites(rows);
  assert.equal(sites.length, 3);
  // The undecided row stays on its ADDRESS rather than being given one of the
  // two buildings at random. Painting it onto either would be a coin flip
  // dressed up as a record.
  assert.ok(sites.some((site) => site.key === 'ban:ban-1'));
  assert.ok(sites.some((site) => site.key === 'rnb:RNB-A'));
  assert.ok(sites.some((site) => site.key === 'rnb:RNB-B'));
});

test('a row carrying its own id keeps it, whatever its address lends', () => {
  const sites = groupDpeSites([
    row('a', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('b', { ban: 'ban-1', rnb: 'RNB-A' }),
    row('c', { ban: 'ban-1', rnb: 'RNB-Z' }),
  ]);
  assert.equal(sites.length, 2, 'the third names a different building and is one');
});

/* ── 3. the shape, and where its badge stands ──────────────────────────── */

test('a GeoJSON footprint becomes rings this repository can draw, or nothing', () => {
  const polygon = geometryParts({
    type: 'Polygon',
    coordinates: [[[2.0, 48.0], [2.001, 48.0], [2.001, 48.001], [2.0, 48.001], [2.0, 48.0]]],
  });
  assert.equal(polygon.length, 1);
  assert.ok(polygon[0][0].length >= 4);
  const multi = geometryParts({
    type: 'MultiPolygon',
    coordinates: [
      [[[2.0, 48.0], [2.001, 48.0], [2.001, 48.001], [2.0, 48.0]]],
      [[[2.01, 48.0], [2.011, 48.0], [2.011, 48.001], [2.01, 48.0]]],
    ],
  });
  assert.equal(multi.length, 2);
  assert.deepEqual(geometryParts({ type: 'LineString', coordinates: [[1, 2]] }), []);
  assert.deepEqual(geometryParts(null), []);
  // A ring that encloses nothing is not a smaller truth, it is no shape.
  assert.deepEqual(geometryParts({ type: 'Polygon', coordinates: [[[2, 48], [2, 48]]] }), []);
});

test('the badge stands inside its building, not at a centroid outside it', () => {
  // A U — a block around a courtyard, which is the ordinary Paris shape. Its
  // centroid sits in the courtyard, on ground the outline does not cover.
  const ring = [
    [0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0],
  ];
  // `[[outer, ...holes], …]` — one part, one ring.
  const anchor = partsAnchor([[ring]]);
  assert.ok(anchor, 'a shape this size gets an anchor');
  const inU = (lon, lat) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) === (yj > lat)) continue;
      if (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  assert.equal(inU(anchor.lon, anchor.lat), true, 'the anchor is on the building');
  assert.equal(inU(1.5, 2), false, 'and the centroid it refused is in the courtyard');
  assert.ok(anchor.areaM2 > 0);
});

test('a courtyard is subtracted from the area, never filled in', () => {
  const square = (x, y, size) => [
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ];
  const solid = partsAnchor([[square(2, 48, 0.001)]]);
  const holed = partsAnchor([[square(2, 48, 0.001), square(2.0002, 48.0002, 0.0004)]]);
  assert.ok(solid.areaM2 > holed.areaM2, `${solid.areaM2} m² against ${holed.areaM2} m²`);
});

/* ── 4. how a site says where it is ────────────────────────────────────── */

test('a record and a deduction never read the same', () => {
  assert.match(
    dpeSitePlacementLine({ shape: { via: 'id' } }),
    /nommé par le diagnostic/,
  );
  assert.match(
    dpeSitePlacementLine({ shape: { via: 'inside' } }),
    /retrouvé sous le point BAN/,
  );
  assert.match(
    dpeSitePlacementLine({ shape: { via: 'closest', distanceM: 7.4 } }),
    /le plus proche du point BAN — 7 m, déduction/,
  );
  // No shape at all: the badge is standing on a street geocode, and says so.
  assert.match(dpeSitePlacementLine({ kind: 'address' }), /position BAN/);
  assert.match(
    dpeSitePlacementLine({ kind: 'building' }),
    /emprise non publiée/,
    'the register named a building the RNB could not draw — a third answer',
  );
});

/* ── the rule the theme and the badges share ───────────────────────────── */

test('the summary moved but did not change', () => {
  const summary = dpeBuildingSummary([
    { etiquetteDpe: 'C' }, { etiquetteDpe: 'C' }, { etiquetteDpe: 'E' }, { etiquetteDpe: null },
  ]);
  assert.equal(summary.grade, 'C');
  assert.equal(summary.total, 4);
  assert.equal(summary.ungraded, 1);
  assert.equal(summary.mixed, true);
  assert.deepEqual([summary.best, summary.worst], ['C', 'E']);
  assert.equal(dpeGradeOf({ etiquetteDpe: 'g' }), 'G', 'case is not a grade');
  assert.equal(dpeGradeOf({ etiquetteDpe: 'H' }), null);
});

test('the shape budget is a number the proxy can spend, not a suggestion', () => {
  assert.ok(Number.isInteger(DPE_SITE_MAX) && DPE_SITE_MAX > 0);
});
