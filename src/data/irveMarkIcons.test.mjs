// The mark of a charge point.
//
// This pack exists because of one measurement: over Bordeaux at 12 653 m,
// straight down, the layer drew 318 marks of 7 px and nobody could find them —
// the reader who reported it offered the proof that the author could not find
// them either. The tests below pin the four properties that make the
// replacement findable, and the one that keeps it honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IRVE_MARK_PUNCH_MIN_PX,
  IRVE_MARK_RASTER_PX,
  irveMarkGlyph,
} from './irveMarkIcons.js';

/** The SVG behind a data URI, so the assertions read the artwork itself. */
const svgOf = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');

test('every variant is a data URI an atlas can take', () => {
  for (const opts of [
    {}, { punched: false }, { hollow: true }, { hollow: true, punched: false }, { key: true },
  ]) {
    const uri = irveMarkGlyph(opts);
    assert.match(uri, /^data:image\/svg\+xml;base64,/);
    assert.match(svgOf(uri), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  }
});

test('four rasters serve the whole fleet, and they are cached', () => {
  // The band colour rides on `billboard.color`, never on the artwork, so six
  // bands over 4 000 marks cost four atlas entries rather than one per mark —
  // the trap `cesium-particules-et-billboards-traps` records.
  const variants = new Set([
    irveMarkGlyph({}),
    irveMarkGlyph({ punched: false }),
    irveMarkGlyph({ hollow: true }),
    irveMarkGlyph({ hollow: true, punched: false }),
  ]);
  assert.equal(variants.size, 4);
  // Identity, not just equality: a second call must return the cached string so
  // Cesium recognises the same image and does not re-enter the atlas.
  assert.equal(irveMarkGlyph({}), irveMarkGlyph({}));
  assert.equal(irveMarkGlyph({ hollow: true }), irveMarkGlyph({ hollow: true }));
});

test('the artwork is WHITE and the casing BLACK, so the tint is the band colour', () => {
  // Cesium multiplies `billboard.color` into the texture. White takes the
  // colour exactly; black survives any multiply (0 × c = 0) and keeps the mark
  // readable over pale terrain. A baked hue is a bug, not a look — `cctv.js`
  // is the proof: #75e7ff × #ffd97a rendered the selected camera green.
  const solid = svgOf(irveMarkGlyph({}));
  assert.match(solid, /fill="#ffffff"/);
  assert.match(solid, /rgba\(0,0,0,/);
  // No band ink anywhere in the artwork, for any variant.
  for (const opts of [{}, { hollow: true }, { punched: false }]) {
    assert.doesNotMatch(svgOf(irveMarkGlyph(opts)), /#0482ed|#08a5d9|#00c6be|#7ee17a|#f3e967/i);
  }
});

test('the refusal is a RIM, so its middle is genuinely empty (D3)', () => {
  // A hollow plate drawn as two discs would still occlude the imagery behind
  // it at the alpha Cesium composites with, and "we could not read this" would
  // read as a sixth step of the ramp. It is a stroked circle.
  const hollow = svgOf(irveMarkGlyph({ hollow: true }));
  assert.match(hollow, /fill="none"/);
  assert.match(hollow, /stroke-width="\d/);
  assert.doesNotMatch(svgOf(irveMarkGlyph({})), /fill="none"/);
});

test('the bolt is punched through a mask, not drawn as ink', () => {
  // `fill-rule="evenodd"` spans the subpaths of ONE path element, so it cannot
  // punch through artwork arriving inside a `<g transform>` — which is every
  // borrowed icon, since fitting a 960-unit box into a 96-unit plate is a
  // transform. The hole has to be an SVG `<mask>`.
  const punched = svgOf(irveMarkGlyph({}));
  assert.match(punched, /<mask id="m"/);
  assert.match(punched, /mask="url\(#m\)"/);
  assert.match(punched, /<g transform="translate\([-\d. ]+\) scale\([\d.]+\)"><path d="M360-360H236/);
  // Below the punch floor the bolt is dropped rather than smudged: the plate
  // survives minification, the hole in it does not.
  const bare = svgOf(irveMarkGlyph({ punched: false }));
  assert.doesNotMatch(bare, /<path/);
  assert.match(bare, /<mask id="m"/, 'the mask stays, so the two rasters composite identically');
});

test('the vendored path is Material’s own, coordinate for coordinate', () => {
  // Only the `d` string was taken, verbatim, in Material's 960-unit box —
  // the claim `licenses/material-symbols/NOTICE` makes, asserted here so a
  // "tidy-up" of the artwork fails the build instead of quietly redrawing a
  // glyph somebody else authored and this project only borrowed.
  const expected = 'M360-360H236q-24 0-35.5-21.5T203-423l299-430q10-14 26-19.5t33 '
    + '.5q17 6 25 21t6 32l-32 259h155q26 0 36.5 23t-6.5 43L416-100q-11 13-27 17t-31-3q-15-7-23.5-'
    + '21.5T328-139l32-221Z';
  assert.ok(svgOf(irveMarkGlyph({})).includes(`d="${expected}"`));
});

test('the key swatch drops the casing, or the shape channel vanishes', () => {
  // The on-map key masks its swatch and a CSS mask reads ALPHA, so an opaque
  // casing would flatten a solid plate and a hollow one into the same dot.
  const onMap = svgOf(irveMarkGlyph({}));
  const inKey = svgOf(irveMarkGlyph({ key: true }));
  assert.match(onMap, /rgba\(0,0,0,/);
  assert.doesNotMatch(inKey, /rgba\(0,0,0,/);
  // And the hollow variant stays hollow in the key, which is the whole point of
  // giving the refusal a shape rather than a tint.
  assert.match(svgOf(irveMarkGlyph({ hollow: true, key: true })), /fill="none"/);
});

test('the raster size and the punch floor are the figures the layer draws at', () => {
  // Cesium's billboard atlas has no mipmaps, so a texture much larger than its
  // on-screen footprint is minified into mush. 88 covers the 16–26 CSS px band.
  assert.equal(IRVE_MARK_RASTER_PX, 88);
  assert.match(svgOf(irveMarkGlyph({})), /width="88" height="88"/);
  assert.match(svgOf(irveMarkGlyph({ px: 24 })), /width="24" height="24"/);
  // 16, where the sibling pack needs 20 — a bolt has no interior detail to
  // lose where a water drop's highlight crescent closes up first.
  assert.equal(IRVE_MARK_PUNCH_MIN_PX, 16);
});
