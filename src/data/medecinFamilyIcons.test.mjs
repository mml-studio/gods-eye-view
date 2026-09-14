// What the six family marks are allowed to be: a tintable plate with an edge,
// a punched silhouette that is the vendored artwork itself, and a key swatch
// that is the same mark with its ring taken off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MEDECIN_SHAPED_FAMILIES,
  _medecinPunchesForTest,
  _medecinSymbolPathsForTest,
  medecinFamilyGlyph,
  medecinPlateGlyph,
} from './medecinFamilyIcons.js';
import { mapIconArtwork } from './mapIcons.js';
import { MEDECIN_FAMILIES } from './medecinsFrFeed.js';

/** The SVG behind a data URI. */
const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');

/** The plate's radius, read off the artwork rather than restated here. */
const discRadius = (svg) => Number(svg.match(/r="([\d.]+)" fill="#ffffff" mask=/)[1]);

test('every family the feed can emit has a mark, and the set is closed', () => {
  // The two lists are written in two files and drift silently otherwise: a
  // family added to the feed would draw a bare plate for ever without this.
  assert.deepEqual([...MEDECIN_SHAPED_FAMILIES].sort(), [...MEDECIN_FAMILIES].sort());
  for (const family of MEDECIN_SHAPED_FAMILIES) {
    assert.match(medecinFamilyGlyph(family), /^data:image\/svg\+xml;base64,/, family);
  }
});

test('an unknown family draws the bare plate, never a borrowed silhouette', () => {
  // `medecinFamily()` folds an unmapped specialty code into `specialiste`
  // rather than throwing, so a seventh family can only reach here through a
  // future feed. It must arrive as "a practice, kind unknown".
  const plate = medecinPlateGlyph();
  assert.equal(medecinFamilyGlyph('orthodontie'), plate);
  assert.equal(medecinFamilyGlyph(''), plate);
  assert.equal(medecinFamilyGlyph(null), plate);
  assert.doesNotMatch(decode(plate), /<path/, 'the fallback must punch nothing');
});

test('the mark is a plate with an edge, not a silhouette floating on a photo', () => {
  // Bare silhouettes were measured unfindable below 18 px over three real
  // orthophoto crops, and half of this layer's marks draw under that as soon as
  // the camera leaves street level. A plate has a filled body carrying the
  // family hue and a dark ring that is its only edge, and both survive Cesium's
  // colour multiply.
  for (const family of MEDECIN_SHAPED_FAMILIES) {
    const svg = decode(medecinFamilyGlyph(family));
    const ring = svg.match(/<circle cx="48" cy="48" r="([\d.]+)" fill="rgba\(0,0,0,([\d.]+)\)"\/>/);
    assert.ok(ring, `${family} has no ring`);
    assert.ok(Number(ring[2]) >= 0.8, `${family}: a ring at alpha ${ring[2]} is a halo, not an edge`);
    assert.ok(Number(ring[1]) > discRadius(svg), `${family}: the ring must sit outside the plate`);
    assert.match(svg, /fill="#ffffff" mask="url\(#m\)"/, `${family} has no tintable plate`);
    // No hue is baked in, or the multiply would tint a tint: the CCTV bug.
    const hexes = [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase());
    assert.deepEqual([...new Set(hexes)].sort(), ['#000000', '#ffffff'], family);
  }
});

test('the silhouette is punched by a mask, because fill-rule cannot reach it', () => {
  // `fill-rule="evenodd"` spans the subpaths of ONE path element. Every borrowed
  // icon arrives inside a `<g transform>` — fitting a 15 or 960-unit box into
  // this 96-unit plate is a transform — so a hole through it has to be a mask.
  // Getting this wrong does not throw: it draws a plain disc, which is exactly
  // the mark this module exists to stop drawing.
  for (const family of MEDECIN_SHAPED_FAMILIES) {
    const svg = decode(medecinFamilyGlyph(family));
    assert.match(svg, /<mask id="m"[^>]*>/, family);
    assert.match(svg, /<g fill="#000000">/, `${family}: the punch must be painted black in the mask`);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    assert.ok(punch.includes('<path'), `${family} punches nothing`);
  }
});

test('Material artwork is placed from its own y origin, not from zero', () => {
  // Material spans `-960 → 0` in y where every other box in this fleet spans
  // `0 → box`. Fitting it from zero draws the glyph one full box BELOW the
  // plate, which renders as an empty pastille rather than as an error — so the
  // three Material families must carry a y translate the two Maki ones do not.
  const material = ['femme-enfant', 'sante-mentale', 'chirurgie'];
  for (const family of material) {
    const [, x, y] = decode(medecinFamilyGlyph(family))
      .match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
    assert.notEqual(x, y, `${family} was fitted as if Material started at y=0`);
    assert.ok(Number(y) > Number(x), `${family}: the y offset must lift the glyph into the box`);
  }
  for (const family of ['generaliste', 'specialiste', 'imagerie']) {
    const [, x, y] = decode(medecinFamilyGlyph(family))
      .match(/translate\((-?[\d.]+) (-?[\d.]+)\)/);
    assert.equal(x, y, `${family} is authored from the origin and must be centred squarely`);
  }
});

test('a punched silhouette stays inside its plate, and fills it', () => {
  // Two failure modes, one measurement. A shape that overflows the disc stops
  // being a punch and becomes a bite out of the ring — and takes the family hue
  // with it. A shape too small leaves a plate that reads as an undifferentiated
  // dot, which is the mark this change replaced.
  for (const family of MEDECIN_SHAPED_FAMILIES) {
    const svg = decode(medecinFamilyGlyph(family));
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
  for (const family of MEDECIN_SHAPED_FAMILIES) {
    const map = decode(medecinFamilyGlyph(family));
    const key = decode(medecinFamilyGlyph(family, { key: true }));
    const ring = map.match(/<circle cx="48" cy="48" r="[\d.]+" fill="rgba\(0,0,0,[\d.]+\)"\/>/)[0];
    assert.equal(map.replace(ring, ''), key, `${family}: the key diverged from the map`);
    assert.doesNotMatch(key, /rgba\(/, `${family}: the key swatch must be pure alpha`);
  }
});

test('the CC0 sets are borrowed through their public door, never re-vendored', () => {
  const source = fs.readFileSync(new URL('./medecinFamilyIcons.js', import.meta.url), 'utf8');
  // Exactly three vendored path literals live here — the Material Symbols, which
  // have no shared pack of their own in this repository and are held per module
  // the way `plantFiliereIcons.js` and `irveMarkIcons.js` hold theirs. Anything
  // else long enough to be a silhouette is a second copy of CC0 artwork.
  const literals = [...source.matchAll(/M[\d\s,.\-A-Za-z]{200,}/g)];
  assert.equal(literals.length, 3, 'a fourth vendored outline appeared in this module');

  // And what it borrows from the CC0 pack is that pack's path, verbatim.
  assert.ok(decode(medecinFamilyGlyph('generaliste'))
    .includes(mapIconArtwork('maki', 'doctor').geometry));
  assert.ok(decode(medecinFamilyGlyph('specialiste'))
    .includes(mapIconArtwork('maki', 'hospital').geometry));
  assert.ok(decode(medecinFamilyGlyph('imagerie'))
    .includes(mapIconArtwork('temaki', 'radiation').geometry));
});

test('the three Material paths are vendored whole, counters and all', () => {
  const paths = _medecinSymbolPathsForTest();
  assert.deepEqual(Object.keys(paths).sort(), ['escalator_warning', 'psychology', 'surgical']);
  // The cog inside the head is a counter-wound subpath: merged away, the head is
  // a featureless lozenge and the family loses the only thing that names it.
  assert.ok((paths.psychology.match(/[Mm]/g) || []).length >= 3, 'psychology lost its counters');
  // Two figures, not one: an adult and a child of different heights is what
  // makes this read as "femme et enfant" rather than as one person.
  assert.ok((paths.escalator_warning.match(/[Mm]/g) || []).length >= 3, 'the pair became one figure');
});

test('the six punches are six different shapes', () => {
  const punches = _medecinPunchesForTest();
  assert.equal(Object.keys(punches).length, 6);
  assert.equal(new Set(Object.values(punches)).size, 6, 'two families share one shape');
});

test('rasters are cached per family, per size and per variant', () => {
  const first = medecinFamilyGlyph('chirurgie');
  assert.equal(medecinFamilyGlyph('chirurgie'), first, 'the same raster is rebuilt');
  const small = medecinFamilyGlyph('chirurgie', { px: 32 });
  assert.notEqual(small, first);
  assert.notEqual(medecinFamilyGlyph('chirurgie', { px: 32, key: true }), small);
  assert.match(decode(small), /width="32" height="32"/);
  assert.match(decode(first), /width="88" height="88"/);
});
