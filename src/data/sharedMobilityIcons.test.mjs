// The mark a shared vehicle wears: an operator PLATE with its form factor
// punched through, and a monogram badged on it up close.
//
// These tests pin the properties that make that mark mean anything: every kind
// punches its own silhouette, an unknown kind is never given someone else's,
// the whole image stays tint-safe so `billboard.color` can carry the operator,
// and the vendored artwork is still the artwork the licence notices describe.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sharedMobilityGlyph,
  sharedMobilityGlyphKind,
  sharedMobilityMonogramGlyph,
  SHARED_MOBILITY_GLYPH_KINDS,
  MATERIAL_SYMBOL_PATHS,
  _sharedMobilityGlyphBodyForTest,
  _sharedMobilityKindPunchForTest,
  _sharedMobilityPlateForTest,
} from './sharedMobilityIcons.js';
import { MAKI_PATHS, mapIconArtwork } from './mapIcons.js';
import { INTER_CAPITALS } from './interCapitals.js';
import { VEHICLE_KIND_LABELS } from './gbfsFeeds.js';

const decode = (uri) => Buffer.from(uri.split('base64,')[1], 'base64').toString('utf8');
const PLATE = _sharedMobilityPlateForTest();

test('every kind the feeds can report has a plate of its own', () => {
  // The layer folds `form_factor` + `propulsion_type` onto these six; a kind
  // with no drawing would silently inherit whatever `other` looks like.
  for (const kind of Object.keys(VEHICLE_KIND_LABELS)) {
    assert.ok(SHARED_MOBILITY_GLYPH_KINDS.includes(kind), `no glyph for ${kind}`);
  }
  assert.ok(SHARED_MOBILITY_GLYPH_KINDS.includes('station'), 'a dock is drawn as a place, not a vehicle');
});

test('no two kinds share geometry', () => {
  const geometries = SHARED_MOBILITY_GLYPH_KINDS
    .map((kind) => _sharedMobilityGlyphBodyForTest(kind).replace(/\s+/g, ''));
  assert.equal(new Set(geometries).size, SHARED_MOBILITY_GLYPH_KINDS.length);
  const uris = SHARED_MOBILITY_GLYPH_KINDS.map((kind) => sharedMobilityGlyph(kind));
  assert.equal(new Set(uris).size, SHARED_MOBILITY_GLYPH_KINDS.length);
});

test('a bike and an e-bike are ONE drawing plus a bolt, not two drawings', () => {
  // The two vehicles ARE the same object plus a motor, and the reader has to
  // tell them apart at a glance. So the difference is EXTRA ink — a badge that
  // can survive minification — rather than a second, subtly different bicycle
  // that would read as noise at 17 px.
  const punches = _sharedMobilityKindPunchForTest();
  assert.deepEqual(punches.bike.borrow, ['maki', 'bicycle']);
  assert.deepEqual(punches.ebike.borrow, ['maki', 'bicycle']);
  assert.equal(punches.ebike.electric, true);
  assert.ok(!punches.bike.electric, 'a pedal bike carries no badge');

  const bike = _sharedMobilityGlyphBodyForTest('bike');
  const ebike = _sharedMobilityGlyphBodyForTest('ebike');
  assert.ok(ebike.startsWith(bike), 'the e-bike is the bike, then the badge');
  assert.ok(ebike.length > bike.length, 'the electric badge is added ink');
  assert.ok(ebike.includes(MAKI_PATHS['charging-station']), 'the badge is Maki\'s bolt');

  // Only the e-bike wears it. A trottinette and a moped do not need one: the
  // French feeds contain no human-powered kick scooter and no combustion
  // moped, so a badge there would discriminate nothing.
  for (const kind of ['bike', 'scooter', 'moped', 'car']) {
    assert.ok(
      !_sharedMobilityGlyphBodyForTest(kind).includes(MAKI_PATHS['charging-station']),
      `${kind} must not claim to be the electric variant of anything`,
    );
  }
});

test('the vendored Maki artwork is what the module actually draws', () => {
  // CC0 imposes no conditions, but `licenses/maki/NOTICE` claims these paths
  // are verbatim and unrescaled, and this project's own discipline is that the
  // claim stays checkable. A silent edit would make the notice a lie.
  const punches = _sharedMobilityKindPunchForTest();
  // `_bolt` is the electric badge, not a kind: it has no plate of its own and
  // is pinned by the e-bike test above.
  const borrowed = Object.entries(punches)
    .filter(([kind, spec]) => spec.borrow && !kind.startsWith('_'));
  assert.ok(borrowed.length >= 4, 'the plate set is mostly borrowed artwork');
  for (const [kind, spec] of borrowed) {
    const artwork = mapIconArtwork(...spec.borrow);
    assert.ok(artwork, `${kind} points at an icon that is not vendored: ${spec.borrow.join('/')}`);
    // Authored in Maki's own 15-unit box and NOT rescaled — rescaling is a
    // redraw, and a redraw is no longer the artwork that was evaluated. The
    // module reaches its 96-unit plate with a `transform`, which is why the
    // path string below still appears intact.
    assert.equal(artwork.box, 15, `${kind} is not in Maki's 15-unit box`);
    assert.ok(
      _sharedMobilityGlyphBodyForTest(kind).includes(artwork.geometry),
      `${kind} draws something other than the vendored path`,
    );
  }
});

test('Material keeps exactly one glyph, and it is verbatim', () => {
  // Apache-2.0 §4 obliges `licenses/material-symbols/NOTICE` to stay accurate,
  // and it now claims ONE symbol for this module. Four others were removed
  // rather than left unused when the pack moved to Maki; re-adding one here
  // without touching the notice would ship Google artwork outside it.
  assert.deepEqual(Object.keys(MATERIAL_SYMBOL_PATHS), ['electric_scooter']);
  const path = MATERIAL_SYMBOL_PATHS.electric_scooter;
  assert.match(path, /^M/, 'not a path');
  // No commas anywhere. Material publishes compact, comma-free path data
  // (`M200-240q-50 0…`); a comma would mean the artwork was reformatted.
  assert.ok(!path.includes(','), 'the artwork has been reformatted');
  assert.ok(path.length > 300, `looks truncated (${path.length} chars)`);
  // …and it is what actually reaches the canvas, not just what is stored.
  assert.ok(_sharedMobilityGlyphBodyForTest('scooter').includes(path));
  // No cartographic set publishes a kick scooter — checked across Maki and all
  // 557 Temaki icons on 2026-09-14 — which is the whole reason this one stayed.
  assert.equal(_sharedMobilityKindPunchForTest().scooter.material, 'electric_scooter');
});

test('the two hand-drawn bodies are ours, and are FILLED shapes', () => {
  // The plate punches a MASK, and a mask reads coverage: a zero-area stroked
  // path punches nothing at all. That is exactly what happened to the dock rack
  // the first time it was drawn.
  for (const kind of ['other', 'station']) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    assert.ok(
      /<(circle|rect)\b/.test(body),
      `${kind} must be a fillable shape, not a stroked path — got ${body}`,
    );
    for (const path of Object.values(MATERIAL_SYMBOL_PATHS)) {
      assert.ok(!body.includes(path), `${kind} must not borrow Google artwork`);
    }
    for (const path of Object.values(MAKI_PATHS)) {
      assert.ok(!body.includes(path), `${kind} must not borrow Maki artwork`);
    }
  }
});

test('an unmapped kind falls to the disc, never to another kind\'s silhouette', () => {
  // The feed did not say what this is, and drawing a scooter would assert
  // something it never published.
  for (const unknown of ['funicular', '', null, undefined, 'BIKE']) {
    assert.equal(sharedMobilityGlyphKind(unknown), 'other');
  }
  assert.equal(sharedMobilityGlyph('funicular'), sharedMobilityGlyph('other'));
  assert.notEqual(sharedMobilityGlyph('other'), sharedMobilityGlyph('bike'));
});

test('the plate is tint-safe: white ink, black rings, and no hue of its own', () => {
  // Cesium multiplies `billboard.color` into the texture. White takes the
  // operator colour exactly (white × c = c) and the rings survive it
  // (0 × c = 0). A baked hue would multiply into something else and destroy
  // both channels — the failure `cctv.js` records for its camera.
  for (const kind of SHARED_MOBILITY_GLYPH_KINDS) {
    for (const initial of [null, 'D']) {
      const svg = decode(sharedMobilityGlyph(kind, { initial }));
      assert.match(svg, /fill="#ffffff" mask=/, `${kind}: the plate must be tintable white`);
      assert.ok(svg.includes(PLATE.RING_COLOR), `${kind} has no ring`);
      const colors = svg.match(/#[0-9a-f]{3,6}/gi) || [];
      const baked = colors.filter((color) => !/^#(fff|ffffff|000|000000)$/i.test(color));
      assert.equal(baked.length, 0, `${kind} bakes in ${baked}`);
      // rgba() appears only as the ring black. Any other alpha colour would be
      // a hue that survives the multiply as itself.
      for (const rgba of svg.match(/rgba\([^)]*\)/g) || []) {
        assert.equal(rgba, PLATE.RING_COLOR, `${kind} paints ${rgba}`);
      }
    }
  }
});

test('the silhouette is a HOLE in the plate, drawn from one geometry', () => {
  // The punch lives in the mask and nowhere else. Drawing it a second time as
  // white ink would fill the hole back in, and drawing it dark would bake a
  // colour the tint then multiplies.
  for (const kind of ['scooter', 'station', 'car']) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    const svg = decode(sharedMobilityGlyph(kind));
    assert.equal(svg.split(body).length - 1, 1, `${kind}: the geometry appears exactly once`);
    const maskEnd = svg.indexOf('</mask>');
    assert.ok(svg.indexOf(body) > 0 && svg.indexOf(body) < maskEnd, `${kind}: the punch is inside the mask`);
    // Ring first, plate second: the ring is the mark's only edge and has to sit
    // under the plate, not over it.
    assert.ok(svg.indexOf(PLATE.RING_COLOR) < svg.indexOf('fill="#ffffff" mask='), `${kind}: ring under plate`);
  }
});

test('the monogram is a letter-shaped hole in a badge-shaped plate', () => {
  const plain = sharedMobilityGlyph('bike');
  const badged = sharedMobilityGlyph('bike', { initial: 'D' });
  assert.notEqual(plain, badged, 'the badge has to change the image the atlas holds');
  const svg = decode(badged);
  // The letter is Inter's own outline, placed by transform and never redrawn.
  assert.ok(svg.includes(INTER_CAPITALS.D.d), 'the capital is the vendored outline');
  assert.ok(!decode(plain).includes(INTER_CAPITALS.D.d));
  // TWO masks: one punches the vehicle out of the plate, one punches the letter
  // out of the badge. The letter therefore comes back in the black of the badge
  // ring underneath it, at every tint, with no second colour in the file.
  assert.equal((svg.match(/<mask /g) || []).length, 2);
  // Case and length are folded, so a caller passing a whole label cannot
  // smuggle a word into the badge.
  assert.equal(sharedMobilityGlyph('bike', { initial: 'd' }), badged);
  assert.equal(sharedMobilityGlyph('bike', { initial: 'Dott' }), badged);
  // A letter that is not vendored draws NO badge rather than a blank disc.
  assert.equal(sharedMobilityGlyph('bike', { initial: 'É' }), plain);
  assert.equal(sharedMobilityGlyph('bike', { initial: null }), plain);
});

test('the legend monogram is a plate and only a plate', () => {
  const swatch = sharedMobilityMonogramGlyph('L');
  assert.ok(swatch, 'a curated operator has a key swatch');
  const svg = decode(swatch);
  assert.ok(svg.includes(INTER_CAPITALS.L.d));
  assert.equal((svg.match(/<mask /g) || []).length, 1, 'no corner badge on a key row');
  // It must not look like a KIND: no vehicle silhouette rides a legend
  // monogram, or the operator row would start answering "what".
  for (const path of [...Object.values(MAKI_PATHS), ...Object.values(MATERIAL_SYMBOL_PATHS)]) {
    assert.ok(!svg.includes(path), 'a monogram swatch carries no vehicle');
  }
  // Null is a VALID answer: a row with no letter falls back to its plain colour
  // swatch rather than showing an empty disc that reads as a kind.
  assert.equal(sharedMobilityMonogramGlyph(null), null);
  assert.equal(sharedMobilityMonogramGlyph(''), null);
  assert.equal(sharedMobilityMonogramGlyph('É'), null);
});

test('the raster is sized for the billboard, and cached per kind, size and letter', () => {
  const fleet = sharedMobilityGlyph('bike');
  assert.match(decode(fleet), new RegExp(`width="${PLATE.GLYPH_RASTER_PX}" height="${PLATE.GLYPH_RASTER_PX}"`));
  // One coordinate space for the whole pack, shared with `militarySiteIcons.js`
  // so the two plate packs compose identically on the same globe.
  assert.match(decode(fleet), new RegExp(`viewBox="0 0 ${PLATE.VIEW} ${PLATE.VIEW}"`));
  assert.equal(sharedMobilityGlyph('bike'), fleet, 'same call, same string — no per-frame rebuild');
  const legend = sharedMobilityGlyph('bike', { px: 32 });
  assert.notEqual(legend, fleet);
  assert.match(decode(legend), /width="32" height="32"/);
  // Size and letter are both in the cache key, or a legend swatch and a map
  // plate would hand each other the wrong raster.
  assert.notEqual(sharedMobilityGlyph('bike', { px: 32, initial: 'D' }), legend);
});

test('nothing runs off the 96 box — plate, ring or badge', () => {
  // A shape that reaches the edge gets clipped flat, which reads as a cut-off
  // mark at exactly the sizes this layer draws. The badge was clipped on two
  // sides the first time it was placed.
  const { VIEW, CENTRE, DISC_R, RING_W, BADGE_CX, BADGE_CY, BADGE_R, BADGE_RING_W } = PLATE;
  const plateOuter = DISC_R + RING_W / 2;
  assert.ok(CENTRE - plateOuter >= 0 && CENTRE + plateOuter <= VIEW, 'the plate ring is clipped');
  const badgeOuter = BADGE_R + BADGE_RING_W / 2;
  assert.ok(BADGE_CX - badgeOuter >= 0 && BADGE_CX + badgeOuter <= VIEW, 'the badge is clipped horizontally');
  assert.ok(BADGE_CY - badgeOuter >= 0 && BADGE_CY + badgeOuter <= VIEW, 'the badge is clipped vertically');

  // And every punch, read off the transform that places it: `fitted()` centres
  // a `box × fraction` square, so the square it lands on is arithmetic rather
  // than a guess about path coordinates.
  for (const kind of SHARED_MOBILITY_GLYPH_KINDS) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    for (const [, tx, ty, scale] of body.matchAll(
      /translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/g,
    )) {
      // Every borrowed set is square in its own box, so one side is enough.
      const side = Number(scale) * (kind === 'scooter' ? 960 : 15) * (body.includes('translate(0 960)') ? 1 : 1);
      assert.ok(Number(tx) >= -0.5, `${kind}: punch runs off the left`);
      assert.ok(Number(ty) >= -0.5, `${kind}: punch runs off the top`);
      assert.ok(Number(tx) + side <= VIEW + 0.5, `${kind}: punch runs off the right`);
      assert.ok(Number(ty) + side <= VIEW + 0.5, `${kind}: punch runs off the bottom`);
    }
  }
});
