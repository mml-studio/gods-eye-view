// src/data/earthquakes.test.mjs
// The analyst-record seam, and the four claims the rewritten symbology makes:
// magnitude is constant screen pixels, depth is a world-metre ruler, colour is
// age on a greyscale-ordered ramp, and every fallback is both drawable and
// countable. Pure functions are imported directly; the runtime shape is pinned
// against the REAL layer driven by a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  EARTHQUAKE_AGE_BANDS,
  EARTHQUAKE_AGE_UNKNOWN,
  EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS,
  EARTHQUAKE_DEPTH_FLOOR_M,
  EARTHQUAKE_MAG_BASE_PX,
  EARTHQUAKE_MAG_DOMAIN_MAX,
  EARTHQUAKE_MAG_FLOOR,
  EARTHQUAKE_MAG_PX_PER_UNIT,
  EARTHQUAKE_OVERLAY_COHORT_LIMIT,
  EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
  EARTHQUAKE_LEGEND_NOTE,
  EARTHQUAKE_SELECTED_COLOR,
  EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID,
  ageBandFor,
  buildEarthquakeCard,
  buildEarthquakeLegend,
  buildEarthquakeNote,
  createEarthquakeOverlayEntry,
  createEarthquakeSelectedOverlayEntry,
  createEarthquakesLayer,
  depthRulerMetres,
  emptyEarthquakeTally,
  formatEarthquakeInstant,
  magnitudePixelSize,
  mapAnalystRecord,
  selectEarthquakeOverlayCohort,
} from './earthquakes.js';
import { DataLayerManager } from './manager.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  getRenderGovernorDiagnostics,
  installRenderGovernor,
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';

const FULL_RAW = {
  id: 'us7000abcd',
  mag: 5.2,
  place: '42 km SW of Anchorage, Alaska',
  time: 1_753_600_000_000,
  depth: 41.7,
  lat: 61.02,
  lon: -150.41,
};

/** sRGB relative luminance — the greyscale test B4 asks for, run as arithmetic. */
function relativeLuminance(hex) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

test('earthquake analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: 'us7000abcd',
    magnitude: 5.2,
    depthKm: 41.7,
    lat: 61.02,
    lon: -150.41,
    timeMs: 1_753_600_000_000,
    place: '42 km SW of Anchorage, Alaska',
  });
});

test('earthquake analyst record: missing USGS id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'QUAKE-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'QUAKE-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'QUAKE-0000');
});

test('earthquake analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'us1', mag: NaN, depth: undefined, place: '' }, 0);
  assert.equal(r.magnitude, null);
  assert.equal(r.depthKm, null);
  assert.equal(r.place, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('earthquake analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('earthquake overlay copy keeps source-side magnitude formatting and bounded priority', () => {
  const position = Cesium.Cartesian3.fromDegrees(-150.41, 61.02);
  const entry = createEarthquakeOverlayEntry({
    id: 'us7000abcd',
    position,
    magnitude: 5.24,
    accent: '#ff0000',
  });
  assert.equal(entry.title, 'M5.2');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.protected, undefined);
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);

  const entries = Array.from({ length: EARTHQUAKE_OVERLAY_COHORT_LIMIT + 20 }, (_, index) => ({
    id: `quake-${String(index).padStart(3, '0')}`,
    priority: index,
  }));
  const cohort = selectEarthquakeOverlayCohort(entries);
  assert.equal(cohort.length, EARTHQUAKE_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, `quake-${EARTHQUAKE_OVERLAY_COHORT_LIMIT + 19}`);
  assert.equal(cohort.at(-1).id, 'quake-020');
});

// ── B2 · magnitude is a diameter in CONSTANT SCREEN PIXELS ───────────────────
// The rejected radius was `2^magnitude × 1000` WORLD metres, so a distant M7
// could draw smaller than a nearby M3. Three properties are pinned: the
// relation is linear in magnitude, the domain is frozen at both ends, and an
// unmeasured magnitude yields null rather than a number.
test('magnitude → pixels is linear, frozen at both ends, and null when unmeasured', () => {
  assert.equal(magnitudePixelSize(EARTHQUAKE_MAG_FLOOR), EARTHQUAKE_MAG_BASE_PX);
  assert.equal(magnitudePixelSize(3.5), EARTHQUAKE_MAG_BASE_PX + EARTHQUAKE_MAG_PX_PER_UNIT);
  assert.equal(magnitudePixelSize(5), 13.5);
  assert.equal(magnitudePixelSize(7), 19.5);
  assert.equal(magnitudePixelSize(9), 25.5);

  // Equal magnitude steps are equal pixel steps — the property the whole
  // choice rests on, and the one an "area ∝ value" refactor would break.
  const step = (a, b) => magnitudePixelSize(b) - magnitudePixelSize(a);
  assert.equal(step(3, 4), step(7, 8));
  assert.equal(step(3, 4), EARTHQUAKE_MAG_PX_PER_UNIT);

  // Frozen domain (C1): a mis-parsed feed cannot produce a 400 px blob, and a
  // sub-floor magnitude cannot produce a vanishing one.
  assert.equal(magnitudePixelSize(12), magnitudePixelSize(EARTHQUAKE_MAG_DOMAIN_MAX));
  assert.equal(magnitudePixelSize(-3), EARTHQUAKE_MAG_BASE_PX);

  for (const bad of [null, undefined, NaN, 'M5']) {
    assert.equal(magnitudePixelSize(bad), null, `${String(bad)} is not a magnitude`);
  }
});

// ── depth is a world-metre ruler, 1:1, with a declared floor ────────────────
test('depth → ruler metres is 1:1, floors a measured zero, and is null when unpublished', () => {
  assert.equal(depthRulerMetres(10), 10_000);
  assert.equal(depthRulerMetres(581.432), 581_432);
  assert.equal(depthRulerMetres(700), 700_000);
  // A1: "measured at zero" and "measured above sea level" still get a mark.
  assert.equal(depthRulerMetres(0), EARTHQUAKE_DEPTH_FLOOR_M);
  assert.equal(depthRulerMetres(-2.5), EARTHQUAKE_DEPTH_FLOOR_M);
  // ...but "not measured" gets no ruler at all, which is a different sign.
  for (const bad of [null, undefined, NaN, 'shallow']) {
    assert.equal(depthRulerMetres(bad), null, `${String(bad)} is not a depth`);
  }
});

// ── A2 + B4 · colour carries age, and the ramp survives greyscale ───────────
test('age bands are frozen hours and strictly ordered in luminance', () => {
  const now = 1_753_600_000_000;
  const h = (n) => now - n * 3600e3;
  assert.equal(ageBandFor(h(0.2), now).id, 'h1');
  assert.equal(ageBandFor(h(0.99), now).id, 'h1');
  assert.equal(ageBandFor(h(1.01), now).id, 'h6');
  assert.equal(ageBandFor(h(5.9), now).id, 'h6');
  assert.equal(ageBandFor(h(6.1), now).id, 'h12');
  assert.equal(ageBandFor(h(11.9), now).id, 'h12');
  assert.equal(ageBandFor(h(12.1), now).id, 'h24');
  // The USGS "all_day" file occasionally runs a little past 24 h. Those events
  // stay in the oldest band; they are not silently dropped from the colour key.
  assert.equal(ageBandFor(h(25), now).id, 'h24');

  // B4's own test, run as arithmetic rather than by eye: convert the ramp to
  // greyscale and the order must survive, with usable separation.
  const lum = EARTHQUAKE_AGE_BANDS.map((band) => relativeLuminance(band.color));
  for (let i = 1; i < lum.length; i++) {
    assert.ok(lum[i] < lum[i - 1], `band ${i} must be darker than band ${i - 1}`);
    assert.ok(
      lum[i - 1] / lum[i] >= 1.4,
      `bands ${i - 1}/${i} are ${lum[i - 1].toFixed(3)}/${lum[i].toFixed(3)} — too close to separate`,
    );
  }
});

test('an unusable timestamp is off the ramp, not a fifth age', () => {
  const now = 1_753_600_000_000;
  assert.equal(ageBandFor(null, now), EARTHQUAKE_AGE_UNKNOWN);
  assert.equal(ageBandFor(undefined, now), EARTHQUAKE_AGE_UNKNOWN);
  assert.equal(ageBandFor(NaN, now), EARTHQUAKE_AGE_UNKNOWN);
  // A clock a few minutes ahead is tolerated and read as "just now"; a clock
  // an hour ahead is not a measurement.
  assert.equal(ageBandFor(now + EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS - 1000, now).id, 'h1');
  assert.equal(ageBandFor(now + 3600e3, now), EARTHQUAKE_AGE_UNKNOWN);
  // Its colour must not be mistakable for a member of the ordered ramp.
  const ramp = new Set(EARTHQUAKE_AGE_BANDS.map((band) => band.color));
  assert.ok(!ramp.has(EARTHQUAKE_AGE_UNKNOWN.color));
});

// ── D1 · the legend states BOTH value channels, and counts every fallback ───
test('the key states the colour and the two domains, and stays short', () => {
  const tally = emptyEarthquakeTally();
  tally.drawn = 140;
  tally.labelled = EARTHQUAKE_OVERLAY_COHORT_LIMIT;
  tally.byAge.h1 = 3;
  tally.byAge.h24 = 100;
  tally.byAge[EARTHQUAKE_AGE_UNKNOWN.id] = 2;
  tally.noDepth = 4;
  tally.depthFloor = 6;
  const legend = buildEarthquakeLegend(tally);
  const labels = legend.map((entry) => entry.label);

  // D2 — the two shape channels are one row each, and each publishes its
  // FROZEN DOMAIN. A row per tick was the mark reprinted, not a key.
  const size = legend.find((entry) => /^Point —/.test(entry.label));
  assert.ok(size, 'the magnitude row is missing');
  assert.match(size.label, /M2,5 à M9,5/);
  const depth = legend.find((entry) => /^Tige —/.test(entry.label));
  assert.ok(depth, 'the depth row is missing');
  assert.match(depth.label, /0 à 700 km/);
  assert.ok(!labels.includes('M5') && !labels.includes('M9'), 'magnitude ticks came back');
  assert.ok(!labels.includes('70 km') && !labels.includes('700 km'), 'depth ticks came back');
  assert.ok(legend.every((entry) => entry.glyph === undefined), 'a shape row came back');

  // The ruler must still say it is a reading device, never a position, and the
  // point must still refuse the footprint reading the old radius invited.
  assert.match(depth.blurb, /la tige monte, le foyer descend/);
  assert.match(size.blurb, /Ni énergie, ni emprise/);

  // The colour channel keeps every class, with its count (D1).
  for (const band of EARTHQUAKE_AGE_BANDS) assert.ok(labels.includes(band.label), band.label);
  const row = (re) => legend.find((entry) => re.test(entry.label));
  assert.equal(row(/âge non publié/)?.count, 2);
  // The one A1 shape a reader decodes WRONG unaided keeps its row and count.
  assert.equal(row(/profondeur non publiée/)?.count, 4);
  // The two disclosures moved to the A5 slot, so they are NOT rows any more.
  assert.ok(!row(/tige plancher/), 'the floor disclosure belongs in the note');
  assert.ok(!row(/étiquettes de magnitude/), 'the label cap belongs in the note');

  // The size the whole rewrite is about: the block sits over the map, so it is
  // bounded rather than merely "shorter than before".
  const words = legend
    .map((entry) => `${entry.label} ${entry.blurb || ''}`.trim().split(/\s+/).length)
    .reduce((a, b) => a + b, 0);
  assert.ok(legend.length <= 10, `key grew back to ${legend.length} rows`);
  assert.ok(words <= 110, `key grew back to ${words} words`);

  // Every colour swatch is either a real CSS colour or an explicit "not mapped
  // here" row; a legend entry may never invent a hue the map does not draw.
  const drawn = new Set([
    ...EARTHQUAKE_AGE_BANDS.map((band) => band.color),
    EARTHQUAKE_AGE_UNKNOWN.color,
  ]);
  for (const entry of legend) {
    if (entry.color === null) continue;
    assert.ok(drawn.has(entry.color), `legend colour ${entry.color} is drawn nowhere`);
  }
});

test('the A5 note carries the two disclosures, with their counts, and nothing else', () => {
  assert.equal(buildEarthquakeNote(emptyEarthquakeTally()), '');

  const floored = emptyEarthquakeTally();
  floored.drawn = 12;
  floored.labelled = 12;
  floored.depthFloor = 6;
  assert.match(buildEarthquakeNote(floored), /6 foyers à moins d’1 km/);
  assert.doesNotMatch(buildEarthquakeNote(floored), /étiquette/);

  const clipped = emptyEarthquakeTally();
  clipped.drawn = 140;
  clipped.labelled = EARTHQUAKE_OVERLAY_COHORT_LIMIT;
  const note = buildEarthquakeNote(clipped);
  assert.match(note, /Les 140 secousses sont dessinées/);
  assert.match(note, /96 plus fortes magnitudes/);
  assert.doesNotMatch(note, /plancher/);

  // E1 — provenance AND clock, in the slot that frames the classes.
  assert.match(EARTHQUAKE_LEGEND_NOTE, /USGS/);
  assert.match(EARTHQUAKE_LEGEND_NOTE, /60 s/);
});

test('the legend keeps its shape before the first poll, and hides rows that do not apply', () => {
  const legend = buildEarthquakeLegend(emptyEarthquakeTally());
  const labels = legend.map((entry) => entry.label);
  assert.ok(labels.some((l) => /^Point —/.test(l)));
  assert.ok(labels.some((l) => /^Tige —/.test(l)));
  for (const band of EARTHQUAKE_AGE_BANDS) assert.ok(labels.includes(band.label));
  // Nothing is unpublished yet, so that row is absent rather than printed as a
  // zero a reader would have to discount.
  assert.ok(!labels.some((l) => /non publié/.test(l)));
  assert.ok(legend.every((entry) => typeof entry.label === 'string' && entry.label.length > 0));
});

// ── runtime shape ───────────────────────────────────────────────────────────

/**
 * Drive the real layer through one poll against a fabricated feed.
 *
 * `scene` is opt-in: without it `viewer.scene?.canvas` is undefined and the
 * click handler declines to install, which is the shape every pre-existing
 * runtime test was written against. Pass one to exercise the click path, and
 * `click(x, y)` then fires the handler the layer registered.
 */
async function runLayer(features, { overlayHost, drillPick, hitTest, now } = {}) {
  const dataSources = [];
  const hostCalls = [];
  const listeners = new Map();
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  if (drillPick) {
    viewer.scene = { canvas: {}, drillPick: (position) => drillPick(position) };
  }
  const host = overlayHost || {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  if (hitTest) host.hitTest = hitTest;
  const layer = createEarthquakesLayer({
    overlayHost: host,
    now,
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(action, type) { listeners.set(type, action); },
      destroy() { listeners.clear(); },
    }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features }) });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  globalThis.fetch = originalFetch;
  const click = (x, y) => listeners
    .get(Cesium.ScreenSpaceEventType.LEFT_CLICK)?.({ position: { x, y } });
  return {
    layer, viewer, dataSources, hostCalls, click, entities: dataSources[0].entities.values,
  };
}

const now = () => Cesium.JulianDate.now();
const pick = (over, key, fallback) => (Object.hasOwn(over, key) ? over[key] : fallback);
const feature = (over = {}) => ({
  id: over.id || 'us-1',
  geometry: {
    coordinates: [pick(over, 'lon', -150.41), pick(over, 'lat', 61.02), pick(over, 'depth', 33)],
  },
  properties: {
    mag: pick(over, 'mag', 5.2),
    place: over.place || 'Somewhere',
    time: pick(over, 'time', Date.now()),
  },
});

test('every event draws a pixel-sized point and a world-metre ruler, and no ground disc', async () => {
  const t = Date.now();
  const { layer, viewer, entities } = await runLayer([
    feature({ id: 'deep', mag: 4.6, depth: 581.432, time: t - 20 * 60e3 }),
    feature({ id: 'shallow', mag: 2.7, depth: 10, time: t - 20 * 3600e3, lon: 139.7, lat: 35.6 }),
  ]);
  try {
    assert.equal(entities.length, 2);
    for (const entity of entities) {
      assert.equal(entity.ellipse, undefined, 'the meaningless 2^M ground disc must be gone');
      assert.ok(entity.point, 'the epicentre mark is a point graphic');
      assert.equal(entity.point.scaleByDistance, undefined, 'B2: size may not compose with range');
      assert.equal(entity.point.translucencyByDistance, undefined, 'B2: nor may opacity');
      assert.equal(entity.point.disableDepthTestDistance, undefined, 'F1: the mark stays occluded');
      assert.equal(
        entity.point.heightReference.getValue(now()),
        Cesium.HeightReference.CLAMP_TO_GROUND,
      );
      assert.ok(entity.polyline, 'a published depth draws a ruler');
    }

    const [deep, shallow] = entities;
    assert.equal(deep.point.pixelSize.getValue(now()), magnitudePixelSize(4.6));
    assert.equal(shallow.point.pixelSize.getValue(now()), magnitudePixelSize(2.7));

    // The ruler's LENGTH is the depth, in metres, at 1:1 — measured off the
    // geometry rather than trusted from the input.
    const lengthM = (entity) => {
      const [foot, top] = entity.polyline.positions.getValue(now());
      return Cesium.Cartesian3.distance(foot, top);
    };
    assert.ok(Math.abs(lengthM(deep) - 581_432) < 1, `${lengthM(deep)} m is not 581.432 km`);
    assert.ok(Math.abs(lengthM(shallow) - 10_000) < 1, `${lengthM(shallow)} m is not 10 km`);
    // The foot sits on the ellipsoid, under the epicentre, and the ruler goes UP.
    const [foot, top] = deep.polyline.positions.getValue(now());
    assert.ok(Cesium.Cartographic.fromCartesian(foot).height < 1);
    assert.ok(Cesium.Cartographic.fromCartesian(top).height > 580_000);

    // A3: the ruler's WIDTH and ALPHA say nothing — only its length does.
    assert.equal(
      deep.polyline.width.getValue(now()),
      shallow.polyline.width.getValue(now()),
    );
  } finally {
    layer.destroy(viewer);
  }
});

test('colour carries age, on the point, on the ruler and on the floating label', async () => {
  const t = Date.now();
  const { layer, viewer, entities, hostCalls } = await runLayer([
    feature({ id: 'fresh', mag: 5.5, depth: 12, time: t - 20 * 60e3 }),
    feature({ id: 'stale', mag: 5.4, depth: 12, time: t - 23 * 3600e3, lon: 10, lat: 10 }),
  ]);
  try {
    const [fresh, stale] = entities;
    const css = (entity) => entity.point.color.getValue(now()).toCssColorString();
    assert.notEqual(css(fresh), css(stale), 'A2: 20 minutes and 23 hours may not look alike');
    assert.equal(
      css(fresh),
      Cesium.Color.fromCssColorString(EARTHQUAKE_AGE_BANDS[0].color).toCssColorString(),
    );
    assert.equal(
      css(stale),
      Cesium.Color.fromCssColorString(EARTHQUAKE_AGE_BANDS.at(-1).color).toCssColorString(),
    );
    // One colour per event: the ruler is the same reading as its mark. Only
    // the alpha differs, and alpha carries nothing here.
    const rgb = (color) => [color.red, color.green, color.blue].map((c) => Math.round(c * 255));
    for (const entity of [fresh, stale]) {
      assert.deepEqual(
        rgb(entity.polyline.material.color.getValue(now())),
        rgb(entity.point.color.getValue(now())),
      );
    }

    // ...and the floating label's accent is the age, not the old depth band.
    const entries = hostCalls.find(([kind]) => kind === 'entries')[2];
    const accents = new Set(entries.map((entry) => entry.accent));
    assert.deepEqual(
      [...accents].sort(),
      [EARTHQUAKE_AGE_BANDS[0].color, EARTHQUAKE_AGE_BANDS.at(-1).color].sort(),
    );

    // Age is banded ONCE per poll, from one reference instant: the entity keeps
    // the band it was given, and no property is time-dynamic.
    assert.equal(fresh.point.color.isConstant, true);
    assert.equal(fresh.properties.ageBand.getValue(now()), 'h1');
    assert.equal(stale.properties.ageBand.getValue(now()), 'h24');
  } finally {
    layer.destroy(viewer);
  }
});

test('A1: an unpublished depth draws a hollow mark with no ruler, and is counted', async () => {
  const t = Date.now();
  const { layer, viewer, entities } = await runLayer([
    feature({ id: 'nodepth', mag: 4, depth: null, time: t - 60e3 }),
    feature({ id: 'zero', mag: 4, depth: 0, time: t - 60e3, lon: 1, lat: 1 }),
    feature({ id: 'measured', mag: 4, depth: 33, time: t - 60e3, lon: 2, lat: 2 }),
  ]);
  try {
    const [nodepth, zero, measured] = entities;

    // No ruler, and the disc is emptied — a missing ruler alone would read as
    // "shallow", which is a measurement this event does not have.
    assert.equal(nodepth.polyline, undefined);
    assert.equal(nodepth.point.color.getValue(now()).alpha, 0);
    assert.ok(nodepth.point.outlineColor.getValue(now()).alpha > 0.5, 'the ring must remain');

    // A measured zero is a measurement: it keeps a filled disc AND a ruler.
    assert.ok(zero.polyline, 'depth 0 km is measured and still draws a ruler');
    assert.ok(zero.point.color.getValue(now()).alpha > 0.5);
    assert.ok(measured.point.color.getValue(now()).alpha > 0.5);
    // ...and the two fills are the same, so "hollow" reads as depth, not age.
    assert.equal(
      zero.point.color.getValue(now()).toCssColorString(),
      measured.point.color.getValue(now()).toCssColorString(),
    );

    const controls = layer.getRowControls();
    assert.equal(
      controls.legend.find((e) => /profondeur non publiée/.test(e.label))?.count,
      1,
    );
    // The floor is a disclosure, not a mark: it is counted in the A5 slot.
    assert.match(controls.note, /1 foyer à moins d’1 km/);
  } finally {
    layer.destroy(viewer);
  }
});

test('the M2.5 floor holds, and an unusable magnitude is dropped rather than drawn', async () => {
  const t = Date.now();
  const { layer, viewer, entities } = await runLayer([
    feature({ id: 'micro', mag: 2.4, depth: 5, time: t }),
    feature({ id: 'floor', mag: 2.5, depth: 5, time: t, lon: 1, lat: 1 }),
    feature({ id: 'nan', mag: Number.NaN, depth: 5, time: t, lon: 2, lat: 2 }),
    feature({ id: 'null', mag: null, depth: 5, time: t, lon: 3, lat: 3 }),
  ]);
  try {
    // The floor is unchanged, and the two unusable magnitudes are refused — a
    // NaN used to slip past `mag < 2.5` and draw a mark of size NaN.
    assert.deepEqual(entities.map((e) => e.id), ['earthquake:floor']);
    assert.equal(layer.getStats().count, 1);
    for (const entity of entities) {
      assert.ok(Number.isFinite(entity.point.pixelSize.getValue(now())));
    }
  } finally {
    layer.destroy(viewer);
  }
});

test('the legend the panel reads is the one the map drew', async () => {
  const t = Date.now();
  const { layer, viewer } = await runLayer([
    feature({ id: 'a', mag: 5, depth: 33, time: t - 30 * 60e3 }),
    feature({ id: 'b', mag: 4, depth: 33, time: t - 8 * 3600e3, lon: 1, lat: 1 }),
    feature({ id: 'c', mag: 3, depth: 33, time: t - 20 * 3600e3, lon: 2, lat: 2 }),
  ]);
  try {
    // D1: both mount points (row controls and getStats) publish the same key.
    const rows = layer.getRowControls().legend;
    assert.deepEqual(layer.getStats().legend, rows);
    const count = (label) => rows.find((entry) => entry.label === label)?.count;
    assert.equal(count(EARTHQUAKE_AGE_BANDS[0].label), 1);
    assert.equal(count(EARTHQUAKE_AGE_BANDS[2].label), 1);
    assert.equal(count(EARTHQUAKE_AGE_BANDS[3].label), 1);
    // Under the label cap nothing is declared clipped.
    assert.ok(!rows.some((entry) => /étiquettes de magnitude/.test(entry.label)));
  } finally {
    layer.destroy(viewer);
  }
});

test('real earthquake lifecycle publishes host labels while runtime entities carry no label graphic', async () => {
  const hostCalls = [];
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const { layer, viewer, dataSources, entities } = await runLayer([
    feature({ id: 'us-runtime-1', mag: 5.24, depth: 41.7, place: 'Runtime One' }),
    feature({
      id: 'us-runtime-2', mag: 3.01, depth: 310, place: 'Runtime Two', lon: 139.7, lat: 35.6,
    }),
  ], { overlayHost });
  try {
    assert.equal(entities.length, 2, 'runtime guard requires populated real source entities');
    assert.ok(entities.every((entity) => entity.label === undefined));
    const publication = hostCalls.find(([type]) => type === 'entries');
    assert.ok(publication, 'real update path must publish the overlay source');
    assert.deepEqual(publication[2].map(({ title }) => title), ['M5.2', 'M3.0']);
    assert.deepEqual(publication[3], {
      cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
      collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });

    layer.disable(viewer);
    assert.equal(dataSources[0].show, false);
    // Both sources come down together: a card left painted over a hidden layer
    // is a reading with nothing under it.
    assert.deepEqual(hostCalls.slice(-4), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
      ['clear', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID],
      ['visible', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, false],
    ]);
    layer.destroy(viewer);
    assert.equal(dataSources.length, 0);
    assert.deepEqual(hostCalls.slice(-4), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
      ['clear', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID],
      ['visible', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, false],
    ]);
  } finally {
    globalThis.fetch = globalThis.fetch; // no-op; runLayer already restored it
  }
});

// ── The card, and the click that opens it ───────────────────────────────────
// The caveats the key used to print permanently now travel on the card of the
// event they are about. That only holds if every one of them is actually
// attached to a number, so the pin is per-line rather than "the card mentions
// the ruler somewhere".

const CARD_NOW = Date.parse('2026-09-10T20:30:00Z');

test('the card pairs every measurement with the caveat that belongs to it', () => {
  const card = buildEarthquakeCard({
    id: 'us7000abcd',
    magnitude: 4.1,
    depthKm: 12.3,
    place: '5 km NE of Mraighah, Lebanon',
    timeMs: CARD_NOW - 6 * 60e3,
  }, CARD_NOW);
  const [title, ...details] = card.split('\n');

  assert.equal(title, 'M4,1');
  // The magnitude line carries its own pixel size AND the energy ratio: the
  // whole reason the key no longer has to.
  const mag = details.find((line) => line.includes('px'));
  assert.match(mag, /10,8 px/);
  assert.match(mag, /la magnitude, pas l’énergie/);
  assert.match(mag, /×31,6/);
  assert.match(mag, /aucune emprise/);

  // The depth line carries the ruler's direction, next to the depth.
  const depth = details.find((line) => line.startsWith('↧'));
  assert.match(depth, /12,3 km sous le niveau de la mer/);
  assert.match(depth, /VERS LE HAUT/);

  // E1 — the instant REPRESENTED, in UTC because the feed is worldwide, then
  // the distance to now.
  assert.ok(details.includes('🕐 2026-09-10 20:24 UTC · il y a 6 min'), card);
  assert.ok(details.includes('📍 5 km NE of Mraighah, Lebanon'), card);
  assert.ok(details.some((line) => line.includes('us7000abcd')), card);

  // No line is pre-wrapped: the host measures and breaks against maxWidthPx.
  assert.ok(details.every((line) => line.length < 200));
});

test('the card names the three A1 fallbacks in the reader’s own words', () => {
  const noDepth = buildEarthquakeCard({
    id: 'a', magnitude: 2.6, depthKm: null, place: 'Nevada', timeMs: null,
  }, CARD_NOW);
  assert.match(noDepth, /profondeur non publiée — aucune tige, et le point est creux/);
  assert.match(noDepth, /horodatage non publié/);
  assert.doesNotMatch(noDepth, /NaN|undefined|null/);

  // A measured zero is a measurement, and the card says where the 1:1 stops.
  const floored = buildEarthquakeCard({
    id: 'b', magnitude: 6.8, depthKm: 0, place: 'Ridgecrest, CA', timeMs: CARD_NOW,
  }, CARD_NOW);
  assert.match(floored, /0,0 km sous le niveau de la mer/);
  assert.match(floored, /tige au plancher d’1 km/);

  // USGS publishes NEGATIVE depths for foci above sea level. The datum is
  // named with the sign, never as a double negative.
  const above = buildEarthquakeCard({
    id: 'c', magnitude: 3, depthKm: -1.4, place: 'The Geysers, CA', timeMs: CARD_NOW,
  }, CARD_NOW);
  assert.match(above, /1,4 km au-dessus du niveau de la mer/);
  assert.doesNotMatch(above, /-1,4|−1,4/);
});

test('the age line keeps the minutes an age band would round across', () => {
  const at = (ms) => buildEarthquakeCard(
    { id: 'x', magnitude: 4, depthKm: 10, place: 'p', timeMs: CARD_NOW - ms },
    CARD_NOW,
  );
  assert.match(at(30e3), /à l’instant/);
  assert.match(at(6 * 60e3), /il y a 6 min/);
  // 90 minutes is in the 1–6 h band; « il y a 2 h » would read as the far side
  // of a boundary the colour beside it has not crossed.
  assert.match(at(90 * 60e3), /il y a 1 h 30/);
  assert.match(at(2 * 3600e3), /il y a 2 h(?! )/);
  assert.equal(formatEarthquakeInstant(Date.parse('2026-01-02T00:04:00Z')), '2026-01-02 00:04 UTC');
});

test('the card entry is protected, anchored above its mark, and off the age ramp', () => {
  const position = Cesium.Cartesian3.fromDegrees(2, 48);
  const entry = createEarthquakeSelectedOverlayEntry(
    { id: 'us1', magnitude: 5, depthKm: 20, place: 'p', timeMs: CARD_NOW },
    position,
    CARD_NOW,
  );
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.protected, true);
  assert.equal(entry.placement, 'above');
  assert.equal(entry.title, 'M5,0');
  assert.ok(entry.details.length >= 4);
  // The accent may never be a hue the age ramp uses, or the card would read as
  // a fifth age.
  const ramp = new Set(EARTHQUAKE_AGE_BANDS.map((band) => band.color));
  assert.ok(!ramp.has(EARTHQUAKE_SELECTED_COLOR));
  assert.equal(entry.accent, EARTHQUAKE_SELECTED_COLOR);
  assert.equal(createEarthquakeSelectedOverlayEntry(null, position, CARD_NOW), null);
  assert.equal(createEarthquakeSelectedOverlayEntry({ id: 'x' }, null, CARD_NOW), null);
});

/** A drilled hit shaped like Cesium's: `id` is the Entity, whose `id` is ours. */
const hit = (id) => ({ id: { id } });

test('a click on a mark opens its card, and a click on the world closes it', async () => {
  let drilled = [];
  const { layer, viewer, hostCalls, click } = await runLayer([
    feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' }),
    feature({ id: 'us-b', mag: 4, depth: 12, place: 'Bravo', lon: 1, lat: 1 }),
  ], { drillPick: () => drilled, now: () => CARD_NOW });
  try {
    drilled = [hit('earthquake:us-b')];
    click(10, 10);
    const published = hostCalls.filter(([type, source]) => (
      type === 'entries' && source === EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID
    ));
    assert.equal(published.length, 1, 'the click must publish exactly one card');
    assert.equal(published[0][2].length, 1);
    assert.match(published[0][2][0].details.join(' '), /Bravo/);
    assert.deepEqual(published[0][3], { cohortLimit: 1, collisionCapacity: 1, moving: false });

    // The photoreal globe answers a non-null pick with no id (`isWorldPick`),
    // and that is what "the reader clicked the map" looks like now.
    drilled = [{ primitive: {}, id: undefined }];
    click(400, 400);
    assert.deepEqual(hostCalls.at(-1), ['clear', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID]);
  } finally {
    layer.destroy(viewer);
  }
});

test('the floating magnitude label is a click surface, not a caption', async () => {
  const { layer, viewer, hostCalls, click } = await runLayer([
    feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' }),
  ], {
    drillPick: () => [],
    // The label plane is a `pointer-events: none` canvas the depth buffer
    // knows nothing about, so `scene.pick` under `M5.0` answers the globe.
    hitTest: () => ({ sourceId: 'earthquakes', entryId: 'us-a' }),
    now: () => CARD_NOW,
  });
  try {
    click(10, 10);
    const published = hostCalls.filter(([type, source]) => (
      type === 'entries' && source === EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID
    ));
    assert.equal(published.length, 1, 'a click on the label must open the card');
    assert.match(published[0][2][0].details.join(' '), /Alpha/);
  } finally {
    layer.destroy(viewer);
  }
});

test('a click on a sibling layer’s marker is that sibling’s click, not a dismissal', async () => {
  let drilled = [];
  const { layer, viewer, hostCalls, click } = await runLayer([
    feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' }),
  ], { drillPick: () => drilled, now: () => CARD_NOW });
  registerPickOwner('a-sibling', (id) => String(id).startsWith('sibling:'));
  try {
    drilled = [hit('earthquake:us-a')];
    click(10, 10);
    const opened = hostCalls.length;

    drilled = [hit('sibling:42')];
    click(20, 20);
    assert.equal(
      hostCalls.length,
      opened,
      'selecting a neighbouring layer must not silently destroy this reading',
    );
  } finally {
    unregisterPickOwner('a-sibling');
    layer.destroy(viewer);
  }
});

test('the selection ring is a second object, so no channel of the mark is borrowed', async () => {
  let drilled = [];
  const { layer, viewer, dataSources, click } = await runLayer([
    feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' }),
    feature({ id: 'us-hollow', mag: 4, depth: null, place: 'Hollow', lon: 1, lat: 1 }),
  ], { drillPick: () => drilled, now: () => CARD_NOW });
  const entities = dataSources[0].entities;
  try {
    // Every channel of the hollow mark is already a datum — its ring carries
    // the AGE — so the acknowledgement cannot be a repaint.
    const hollow = entities.getById('earthquake:us-hollow');
    const before = {
      pixelSize: hollow.point.pixelSize.getValue(now()),
      outline: hollow.point.outlineColor.getValue(now()).toCssColorString(),
    };
    drilled = [hit('earthquake:us-hollow')];
    click(10, 10);
    assert.equal(hollow.point.pixelSize.getValue(now()), before.pixelSize);
    assert.equal(hollow.point.outlineColor.getValue(now()).toCssColorString(), before.outline);

    const ring = entities.values.find((entity) => entity.id === 'earthquake-selection-ring');
    assert.ok(ring, 'the click must leave a ring');
    assert.equal(ring.point.color.getValue(now()).alpha, 0, 'the ring may not fill the mark');
    assert.ok(ring.point.pixelSize.getValue(now()) > before.pixelSize);
    assert.equal(
      ring.point.outlineColor.getValue(now()).toCssColorString(),
      Cesium.Color.fromCssColorString(EARTHQUAKE_SELECTED_COLOR).toCssColorString(),
    );

    // …and the analyst is not handed the ring as a 3rd earthquake.
    const records = layer.getAnalystRecords();
    assert.equal(records.length, 2);
    assert.ok(records.every((record) => record.magnitude !== null));

    // One ring at a time.
    drilled = [hit('earthquake:us-a')];
    click(20, 20);
    assert.equal(
      entities.values.filter((entity) => entity.id === 'earthquake-selection-ring').length,
      1,
    );
  } finally {
    layer.destroy(viewer);
  }
});

test('a poll re-seats an open card, and drops one whose event left the window', async () => {
  let drilled = [];
  let features = [
    feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' }),
    feature({ id: 'us-b', mag: 4, depth: 12, place: 'Bravo', lon: 1, lat: 1 }),
  ];
  const { layer, viewer, dataSources, hostCalls, click } = await runLayer(features, {
    drillPick: () => drilled,
    now: () => CARD_NOW,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features }) });
  try {
    drilled = [hit('earthquake:us-b')];
    click(10, 10);

    // The poll calls `entities.removeAll()`, so the ring and the anchor are
    // gone unless the layer puts them back.
    await layer.update(viewer);
    assert.ok(
      dataSources[0].entities.values.some((e) => e.id === 'earthquake-selection-ring'),
      'the ring must survive a poll that still carries the event',
    );

    // The 24 h window slides, `us-b` falls out, and a card over an event the
    // layer no longer draws is a reading with nothing under it.
    features = [feature({ id: 'us-a', mag: 5, depth: 33, place: 'Alpha' })];
    await layer.update(viewer);
    assert.deepEqual(hostCalls.at(-1), ['clear', EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID]);
    assert.ok(!dataSources[0].entities.values.some((e) => e.id === 'earthquake-selection-ring'));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

// ── Perf pin: the 2026-08-20 earthquakes frame-rate cliff ────────────────────
// The old geometry was one CLAMP_TO_GROUND ellipse per event, and when its axes
// were a `CallbackProperty` Cesium re-tessellated all 58 ground primitives on
// EVERY frame: 32.4 ms/frame and 30 fps, against 1.4 ms with static axes. The
// ellipses are gone, but the RULE they taught is not: no geometry this layer
// writes may be a per-frame property. Both halves stay pinned — the runtime
// property shape, and the source-level guards.
test('quake geometry is STATIC — a per-frame callback rebuilds the batch every frame', async () => {
  const { layer, viewer, entities } = await runLayer([
    feature({ id: 'us-static-1', mag: 5.5, depth: 8.2, lon: -122.4, lat: 37.79, time: Date.now() }),
  ]);
  try {
    const [entity] = entities;
    const constants = [
      ['point.pixelSize', entity.point.pixelSize],
      ['point.color', entity.point.color],
      ['point.outlineColor', entity.point.outlineColor],
      ['polyline.positions', entity.polyline.positions],
      ['polyline.width', entity.polyline.width],
    ];
    for (const [name, property] of constants) {
      assert.equal(
        property instanceof Cesium.CallbackProperty,
        false,
        `${name} must not be a CallbackProperty — it rebuilds the batch every frame`,
      );
      assert.equal(property.isConstant, true, `${name} must be a constant property`);
    }
    assert.equal(entity.point.pixelSize.getValue(now()), magnitudePixelSize(5.5));
    const [foot, top] = entity.polyline.positions.getValue(now());
    assert.ok(Math.abs(Cesium.Cartesian3.distance(foot, top) - 8200) < 1);
  } finally {
    layer.destroy(viewer);
  }
});

// Dropping the continuous-render hold is only safe if new poll data still reaches
// the screen. In idle mode nothing repaints on its own, so the manager's one-shot
// request after each tick is now load-bearing for this layer. Wires the REAL layer
// into the REAL manager with the governor installed, rather than trusting the
// arrangement by inspection.
test('a quake poll still reaches the screen with the render loop idle', async () => {
  const originalFetch = globalThis.fetch;
  const renderRequests = [];
  const dataSources = [];
  const viewer = {
    scene: { requestRenderMode: false, requestRender: () => renderRequests.push(Date.now()) },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'us-idle-1',
        geometry: { coordinates: [-122.4, 37.79, 8.2] },
        properties: { mag: 4.2, place: 'Idle One', time: Date.now() },
      }],
    }),
  });

  _resetRenderGovernorForTest();
  installRenderGovernor(viewer);
  // Installing the governor enters idle mode, which itself paints one settling
  // frame. Drop that from the baseline or the enable assertion below can pass on
  // the install alone, without the manager ever requesting anything.
  renderRequests.length = 0;
  const manager = new DataLayerManager(viewer);
  // updateInterval -1 keeps the poll loop unarmed; we drive one tick by hand.
  manager.register({ ...layer, updateInterval: -1 });
  try {
    await manager.setEnabled('earthquakes', true, { origin: 'test' });

    // The whole point of the change: enabling quakes must not pin the loop on.
    assert.equal(getRenderGovernorDiagnostics().mode, 'idle', 'quakes must not force continuous render');
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    assert.equal(viewer.scene.requestRenderMode, true, 'the governor really is in idle mode');

    // ...and the poll that populated the marks must still have asked for a frame,
    // because in idle mode nothing repaints on its own.
    assert.ok(dataSources[0].entities.values.length > 0, 'the enable poll produced marks');
    assert.ok(renderRequests.length > 0, 'enabling the layer must request a render in idle mode');
    // Named, not merely counted: the frame has to come from the manager's
    // visibility request, not from some incidental repaint.
    assert.ok(
      getRenderGovernorDiagnostics().recentRequests.some(({ reason }) => reason === 'layer-visibility'),
      'the enable frame must be the manager\'s layer-visibility request',
    );

    // A LATER poll must request its own frame too — the enable-time
    // 'layer-visibility' request cannot cover refreshes that arrive minutes later.
    const beforeRefresh = renderRequests.length;
    await manager._runPeriodicUpdate('earthquakes', manager.layers.get('earthquakes'));
    assert.ok(
      renderRequests.length > beforeRefresh,
      'each refresh tick must request its own render while the loop is idle',
    );
    const reasons = getRenderGovernorDiagnostics().recentRequests.map(({ reason }) => reason);
    assert.ok(
      reasons.includes('layer-tick:earthquakes'),
      `the tick request must be attributed to the layer, got ${JSON.stringify(reasons)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await manager.setEnabled('earthquakes', false, { origin: 'test' }).catch(() => {});
    _resetRenderGovernorForTest();
  }
});

test('the earthquakes layer installs no per-frame callback and no continuous-render hold', () => {
  const raw = readFileSync(new URL('./earthquakes.js', import.meta.url), 'utf8');
  // The header ARGUES about `disableDepthTestDistance` and `scaleByDistance`
  // at length, so the guards below read the CODE, not the prose.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(
    source,
    /new Cesium\.CallbackProperty/,
    'reverting the geometry to a per-frame callback must fail this pin',
  );
  assert.doesNotMatch(
    source,
    /holdContinuousRender/,
    'static geometry has no per-frame animator, so the layer must not pin the render loop on',
  );
  // F1 · declared occlusion regime (a). Defeating the depth test is what made
  // the underground stem draw 26 far-hemisphere phantoms over the near side.
  assert.doesNotMatch(
    source,
    /disableDepthTestDistance/,
    'F1: this layer is occluded; an X-ray mark would need its own declared sign',
  );
  // B2 · the thematic size may never be composed with a range function.
  assert.doesNotMatch(
    source,
    /scaleByDistance/,
    'B2: composing pixel size with range inverts the magnitude hierarchy',
  );
  // The rejected radius, by name.
  assert.doesNotMatch(
    source,
    /Math\.pow\(2, mag\)/,
    'the decorative 2^magnitude radius must not come back',
  );
});

test('earthquake refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'USGS HTTP 503');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
