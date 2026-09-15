// Thirteen families, thirteen silhouettes, and one promise about the artwork.
//
// The claims this file pins are the ones a refactor breaks silently: a glyph
// that renders as an empty pastille (Material's y origin), a family that
// quietly falls back to the bare plate (a vendored icon renamed upstream), and
// a second copy of CC0 artwork pasted in rather than borrowed through
// `mapIcons.js` — which is the one thing both NOTICE files promise did not
// happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AMENITY_GLYPH_RASTER_PX,
  AMENITY_SHAPED_FAMILIES,
  _amenityPunchesForTest,
  _amenitySymbolPathsForTest,
  amenityFamilyGlyph,
  amenityPlateGlyph,
} from './amenityFamilyIcons.js';
import { AMENITY_FAMILIES } from './amenitiesFeed.js';
import { AMENITIES_WITHDRAWN_FAMILIES } from './amenitiesFrance.js';
import { mapIconArtwork } from './mapIcons.js';

const decode = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
const discRadius = (svg) => Number(svg.match(/<circle cx="48" cy="48" r="([\d.]+)" fill="#ffffff" mask/)[1]);

test('every family the layer draws has a mark, and the withdrawn one does not', () => {
  // The set is CLOSED at both ends. A family in the pack with no silhouette
  // draws a bare pastille and reads as a thirteenth subject nobody named; a
  // silhouette for a family the layer does not draw is artwork for a mark that
  // can never appear.
  const drawn = AMENITY_FAMILIES.filter((family) => !AMENITIES_WITHDRAWN_FAMILIES.includes(family));
  assert.deepEqual([...AMENITY_SHAPED_FAMILIES].sort(), [...drawn].sort());
  for (const family of AMENITY_SHAPED_FAMILIES) {
    assert.notEqual(amenityFamilyGlyph(family), amenityPlateGlyph(), `${family} fell back to the plate`);
  }
});

test('the hospital asks for a mark and gets the honest one', () => {
  // Not an oversight and not a crash: `hopital` left for « Santé & secours »
  // and a caller that still asks must get "an amenity, and this pack cannot
  // tell you which kind" rather than a shape that would be a claim.
  assert.equal(amenityFamilyGlyph('hopital'), amenityPlateGlyph());
  assert.equal(amenityFamilyGlyph('ecole'), amenityPlateGlyph());
  assert.equal(amenityFamilyGlyph(null), amenityPlateGlyph());
});

test('the mark is a plate with an edge, not a silhouette floating on a photo', () => {
  // Measured for `militarySiteIcons.js` on three real orthophoto crops: a bare
  // silhouette is unfindable below 18 px, and most of this layer's range is
  // below 18 px. The ring is what makes it a mark for a PLACE.
  for (const family of AMENITY_SHAPED_FAMILIES) {
    const svg = decode(amenityFamilyGlyph(family));
    const ring = svg.match(/<circle cx="48" cy="48" r="([\d.]+)" fill="rgba\(0,0,0,([\d.]+)\)"\/>/);
    assert.ok(ring, `${family} lost its ring`);
    assert.ok(Number(ring[1]) > discRadius(svg), `${family}: the ring is inside the plate`);
  }
});

test('the silhouette is punched by a mask, because fill-rule cannot reach it', () => {
  // `fill-rule="evenodd"` spans the subpaths of ONE path element and cannot
  // punch through artwork that arrives inside a `<g transform>` — which is
  // every borrowed icon. Getting this wrong draws a plain disc and raises
  // nothing.
  for (const family of AMENITY_SHAPED_FAMILIES) {
    const svg = decode(amenityFamilyGlyph(family));
    assert.match(svg, /<mask id="m"[^>]*>/, family);
    assert.match(svg, /<g fill="#000000">/, `${family}: the punch must be painted black in the mask`);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    assert.ok(punch.includes('<path'), `${family} punches nothing`);
  }
});

test('Material artwork is placed from its own y origin, not from zero', () => {
  // Material spans `-960 → 0` in y where every other box in this fleet spans
  // `0 → box`. Fitting it from zero draws the glyph one full box BELOW the
  // plate, which renders as an empty pastille rather than as an error.
  const [, x, y] = decode(amenityFamilyGlyph('commerce'))
    .match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
  assert.notEqual(x, y, 'commerce was fitted as if Material started at y=0');
  assert.ok(Number(y) > Number(x), 'the y offset must lift the glyph into the box');
  for (const family of AMENITY_SHAPED_FAMILIES.filter((name) => name !== 'commerce')) {
    const [, mx, my] = decode(amenityFamilyGlyph(family))
      .match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
    assert.equal(mx, my, `${family} is authored from the origin and must be centred squarely`);
  }
});

test('a punched silhouette stays inside its plate, and fills it', () => {
  // Two failure modes, one measurement. A shape that overflows the disc stops
  // being a punch and becomes a bite out of the ring — and takes the family hue
  // with it. A shape too small leaves a plate that reads as an undifferentiated
  // dot, which is the mark this change replaced.
  for (const family of AMENITY_SHAPED_FAMILIES) {
    const svg = decode(amenityFamilyGlyph(family));
    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    // Material's coordinates are signed and its y runs negative, so the reach is
    // the largest ABSOLUTE coordinate rather than the largest number.
    const reach = Math.max(...[...punch.matchAll(/-?[\d.]+/g)]
      .map((match) => Math.abs(Number(match[0])))
      .filter((value) => Number.isFinite(value) && value <= 1000));
    const span = scale * reach;
    const plate = 2 * discRadius(svg);
    assert.ok(span <= plate, `${family} draws ${span.toFixed(1)} units into a ${plate} plate`);
    assert.ok(span >= plate / 2, `${family} punches only ${span.toFixed(1)} units of a ${plate} plate`);
  }
});

test('the key variant is the map mark minus its ring, and nothing else', () => {
  // The on-map key masks its swatch and a CSS mask reads ALPHA, so the ring —
  // which makes the whole disc opaque — would flatten every family into the same
  // dot. Dropping it is the ONLY difference allowed: a key drawn from its own
  // geometry could show a shape the globe does not.
  for (const family of AMENITY_SHAPED_FAMILIES) {
    const map = decode(amenityFamilyGlyph(family));
    const key = decode(amenityFamilyGlyph(family, { key: true }));
    const ring = map.match(/<circle cx="48" cy="48" r="[\d.]+" fill="rgba\(0,0,0,[\d.]+\)"\/>/)[0];
    assert.equal(map.replace(ring, ''), key, `${family}: the key diverged from the map`);
    assert.doesNotMatch(key, /rgba\(/, `${family}: the key swatch must be pure alpha`);
  }
});

test('the CC0 set is borrowed through its public door, never re-vendored', () => {
  const source = fs.readFileSync(new URL('./amenityFamilyIcons.js', import.meta.url), 'utf8');
  // Exactly ONE vendored path literal lives here — Material's `storefront`,
  // which has no shared pack of its own in this repository. Anything else long
  // enough to be a silhouette is a second copy of CC0 artwork that `mapIcons.js`
  // already holds, and a second copy is a second thing to keep in step with the
  // NOTICE.
  const literals = [...source.matchAll(/M[\d\s,.\-A-Za-z]{200,}/g)];
  assert.equal(literals.length, 1, 'a second vendored outline appeared in this module');

  // And what it borrows from the CC0 pack is that pack's path, verbatim: a
  // rescale or a redraw fails here rather than shipping.
  for (const [family, set, name] of [
    ['restaurant', 'maki', 'restaurant'],
    ['boulangerie', 'maki', 'bakery'],
    ['medecin', 'maki', 'doctor'],
    ['courses', 'maki', 'grocery'],
    ['pharmacie', 'maki', 'pharmacy'],
    ['gendarmerie', 'maki', 'police'],
    ['piscine', 'maki', 'swimming'],
  ]) {
    assert.ok(decode(amenityFamilyGlyph(family)).includes(mapIconArtwork(set, name).geometry),
      `${family} does not carry ${set}/${name} verbatim`);
  }
});

test('the vendored Material path is whole, counters and all', () => {
  const paths = _amenitySymbolPathsForTest();
  assert.deepEqual(Object.keys(paths), ['storefront']);
  // The awning's bands are counter-wound subpaths. Merged away, the shopfront
  // is a lozenge and the family loses the only thing that reads at 12 px.
  assert.ok((paths.storefront.match(/[Mm]/g) || []).length >= 3, 'the shutter lost its bands');
});

test('the thirteen punches are thirteen different shapes', () => {
  const punches = _amenityPunchesForTest();
  assert.equal(Object.keys(punches).length, 13);
  assert.equal(new Set(Object.values(punches)).size, 13, 'two families share one shape');
});

test('the marks are distinct all the way to the raster, not just in the punch', () => {
  // A regression this project has actually had in a harness: every glyph shares
  // the same 26-character data-URI prefix AND the same closing `<circle …
  // mask="url(#m)"/></svg>`, so a fingerprint taken from either end reports one
  // shape thirteen times. Measured: 13 distinct glyphs, 3 distinct tails of 64.
  const glyphs = AMENITY_SHAPED_FAMILIES.map((family) => amenityFamilyGlyph(family));
  assert.equal(new Set(glyphs).size, 13);
});

test('rasters are cached per family, per size and per variant', () => {
  const first = amenityFamilyGlyph('piscine');
  assert.equal(amenityFamilyGlyph('piscine'), first, 'the same raster is rebuilt');
  const small = amenityFamilyGlyph('piscine', { px: 32 });
  assert.notEqual(small, first);
  assert.notEqual(amenityFamilyGlyph('piscine', { px: 32, key: true }), small);
  assert.match(decode(small), /width="32" height="32"/);
  assert.match(decode(first), new RegExp(`width="${AMENITY_GLYPH_RASTER_PX}"`));
});
