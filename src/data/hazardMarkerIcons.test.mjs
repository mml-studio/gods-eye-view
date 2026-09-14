import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAZARD_GLYPH_RASTER_PX,
  _hazardGlyphPartsForTest,
  hazardPlateGlyph,
} from './hazardMarkerIcons.js';
import { addressMarkerGlyph } from './addressMarkerIcons.js';

/** The SVG behind a data URI. */
const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');

test('the mark is a data URI, cached, and sized as asked', () => {
  const glyph = hazardPlateGlyph();
  assert.match(glyph, /^data:image\/svg\+xml;base64,/);
  // Same object back: the atlas entry is paid for once per size.
  assert.equal(hazardPlateGlyph(), glyph);
  assert.match(decode(glyph), new RegExp(`width="${HAZARD_GLYPH_RASTER_PX}"`));
  assert.match(decode(hazardPlateGlyph({ px: 32 })), /width="32"/);
  assert.notEqual(hazardPlateGlyph({ px: 32 }), glyph);
});

test('the plate is a filled mass with an edge, not the filament it replaces', () => {
  const svg = decode(hazardPlateGlyph());
  const { plate, round, ringWidth } = _hazardGlyphPartsForTest();

  // The body is FILLED white — the value Cesium's multiply turns into the
  // layer colour. The old mark's triangle was `fill="none"` with a stroke.
  assert.ok(svg.includes(`<path d="${plate}" fill="#ffffff"`), svg);
  // And the ring behind it is the same silhouette, wider, in black.
  assert.ok(svg.includes(`<path d="${plate}" fill="rgba(0,0,0,0.86)"`), svg);
  const ringStroke = Number(svg.match(/fill="rgba\(0,0,0,0\.86\)" stroke="rgba\(0,0,0,0\.86\)" stroke-width="([\d.]+)"/)[1]);
  assert.equal(ringStroke, round + ringWidth * 2);

  // The predecessor, for contrast: white ink applied as a STROKE on an
  // unfilled path. This is the shape of the defect, not a style preference.
  const line = decode(addressMarkerGlyph('hazard'));
  assert.ok(/fill="none"/.test(line), line.slice(0, 400));
});

test('the plate and its ring stay inside the 96-unit box', () => {
  // A glyph clipped by its own viewBox loses a corner in the billboard atlas,
  // and a hazard triangle with a flat corner is a different sign. The first
  // draft of this module overflowed the left edge by half a unit.
  const { plate, round, ringWidth, view } = _hazardGlyphPartsForTest();
  const points = [...plate.matchAll(/(\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(points.length, 3);
  // A round line-join extends the shape by half the stroke width in every
  // direction, and the ring is stroked wider still.
  const reach = (round + ringWidth * 2) / 2;
  for (const [x, y] of points) {
    assert.ok(x - reach >= 0 && x + reach <= view, `x=${x} reach=${reach}`);
    assert.ok(y - reach >= 0 && y + reach <= view, `y=${y} reach=${reach}`);
  }
});

test('the bang is a hole, so its contrast does not depend on the roof below', () => {
  const svg = decode(hazardPlateGlyph());
  // Inside the mask, in black — which is what a mask subtracts. A bang drawn
  // ON the plate would be invisible wherever the plate is dark.
  const mask = svg.match(/<mask[^>]*>([\s\S]*?)<\/mask>/)[1];
  assert.ok(mask.includes('stroke="#000000"'), mask);
  assert.ok(mask.includes('<circle cx="48" cy="65" r="5.5" fill="#000000"/>'), mask);
  assert.ok(svg.includes('mask="url(#m)"'));
  // The dot is a filled circle and never a zero-length stroke: not every
  // rasteriser draws a round cap on an empty segment.
  assert.ok(!/stroke-width="0"/.test(svg));
});

test('no hue is baked in, so one artwork serves all three severities', () => {
  const svg = decode(hazardPlateGlyph());
  const colours = new Set([...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]));
  // White takes the tint exactly, black survives the multiply. Anything else
  // would fight `billboard.color` and destroy the severity channel.
  assert.deepEqual([...colours].sort(), ['#000000', '#ffffff', 'rgba(0,0,0,0.86)']);
});

test('the key swatch drops the ring, which would flatten a masked swatch', () => {
  const map = decode(hazardPlateGlyph());
  const key = decode(hazardPlateGlyph({ key: true }));
  assert.ok(map.includes('rgba(0,0,0,0.86)'));
  // A CSS mask reads ALPHA: an opaque ring makes every swatch the same solid
  // triangle, and the bang stops being visible at all.
  assert.ok(!key.includes('rgba(0,0,0,0.86)'), key);
  // Everything else is identical — same plate, same punch.
  assert.ok(key.includes('mask="url(#m)"'));
});
