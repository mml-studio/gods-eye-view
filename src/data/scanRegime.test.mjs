// src/data/scanRegime.test.mjs
// The switch between "one mark per sale" and "one mark per patch of ground",
// and the box arithmetic behind it. Everything here is pure, and the one
// property that matters most is the one a reader FEELS rather than sees: two
// camera positions inside the same tile must produce the identical box, or
// panning a street re-asks a question whose answer is already on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAN_BANDS,
  SCAN_CELL_MIN_ALTITUDE_M,
  boxSamplePoints,
  readScanCellBox,
  scanBandFor,
  scanBoxKey,
  scanCellBox,
  scanCellParams,
  scanTiles,
} from './scanRegime.js';

test('below the switch the scan stays a disc', () => {
  assert.equal(scanBandFor({ altitudeM: SCAN_CELL_MIN_ALTITUDE_M - 1 }), null);
  assert.deepEqual(scanCellParams({ lat: 45.77, lon: 4.85, altitudeM: 120 }), {});
});

test('a pin is always a disc, however high the camera', () => {
  const point = { lat: 45.77, lon: 4.85, altitudeM: 9_000, pinned: true };
  assert.equal(scanBandFor(point), null);
  assert.deepEqual(scanCellParams(point), {});
});

test('the bands are ordered and cover every altitude above the switch', () => {
  assert.equal(scanBandFor({ altitudeM: 1_322 }).id, 'fine');
  assert.equal(scanBandFor({ altitudeM: 1_799 }).id, 'fine');
  assert.equal(scanBandFor({ altitudeM: 1_800 }).id, 'coarse');
  assert.equal(scanBandFor({ altitudeM: 11_000 }).id, 'coarse');
  for (const band of SCAN_BANDS) {
    assert.ok(band.tileDeg > 0 && band.cellM > 0);
  }
});

test('the box is two tiles on each axis, whatever the band', () => {
  for (const band of SCAN_BANDS) {
    const box = scanCellBox(45.7753, 4.8497, band.tileDeg);
    assert.ok(Math.abs((box.north - box.south) - (band.tileDeg * 2)) < 1e-9);
    assert.ok(Math.abs((box.east - box.west) - (band.tileDeg * 2)) < 1e-9);
    assert.equal(scanTiles(box, band.tileDeg).length, 4);
  }
});

test('two points in the same tile ask the identical question', () => {
  // 45.7753 and 45.7769 both round to the 45.78 line at 0.01°; the boxes must
  // be byte-identical, because the shell compares the query string.
  const a = scanCellParams({ lat: 45.7753, lon: 4.8497, altitudeM: 1_322 });
  const b = scanCellParams({ lat: 45.7769, lon: 4.8531, altitudeM: 1_100 });
  assert.deepEqual(a, b);
  assert.equal(scanBoxKey(readScanCellBox(new URLSearchParams(a)).box),
    scanBoxKey(readScanCellBox(new URLSearchParams(b)).box));
});

test('the look-at point is never more than half a tile off centre', () => {
  const { tileDeg } = SCAN_BANDS[0];
  for (const offset of [0, 0.0021, 0.0049, 0.0051, 0.0099]) {
    const lat = 45.77 + offset;
    const box = scanCellBox(lat, 4.85, tileDeg);
    const middle = (box.north + box.south) / 2;
    assert.ok(Math.abs(lat - middle) <= (tileDeg / 2) + 1e-9,
      `${lat} sat ${Math.abs(lat - middle)} from the middle`);
  }
});

test('the tiles tile the box exactly, with no gap and no overlap', () => {
  const band = SCAN_BANDS[0];
  const box = scanCellBox(45.7753, 4.8497, band.tileDeg);
  const tiles = scanTiles(box, band.tileDeg);
  const area = (b) => (b.north - b.south) * (b.east - b.west);
  const sum = tiles.reduce((total, tile) => total + area(tile), 0);
  assert.ok(Math.abs(sum - area(box)) < 1e-12);
  for (const tile of tiles) {
    assert.ok(tile.south >= box.south - 1e-9 && tile.north <= box.north + 1e-9);
    assert.ok(tile.west >= box.west - 1e-9 && tile.east <= box.east + 1e-9);
  }
});

test('a span matching no band is refused rather than clamped', () => {
  // Everything here is reachable from a share link, so an arbitrary slab of
  // France must drop back to the disc regime instead of being served.
  const hostile = new URLSearchParams({
    south: '42.000000', west: '0.000000', north: '51.000000', east: '8.000000',
  });
  assert.equal(readScanCellBox(hostile), null);
  const nearlyRight = new URLSearchParams({
    south: '45.760000', west: '4.840000', north: '45.783000', east: '4.860000',
  });
  assert.equal(readScanCellBox(nearlyRight), null);
});

test('an inverted or out-of-globe box is refused', () => {
  assert.equal(readScanCellBox(new URLSearchParams({
    south: '45.780000', west: '4.840000', north: '45.760000', east: '4.860000',
  })), null);
  assert.equal(readScanCellBox(new URLSearchParams({
    south: '89.990000', west: '4.840000', north: '90.010000', east: '4.860000',
  })), null);
});

test('a legal box round-trips to its band', () => {
  const params = scanCellParams({ lat: 45.7753, lon: 4.8497, altitudeM: 1_322 });
  const read = readScanCellBox(new URLSearchParams(params));
  assert.equal(read.band.id, 'fine');
  assert.equal(read.box.south.toFixed(6), params.south);
});

test('the probe grid is odd, so the middle of the box is always sampled', () => {
  for (const band of SCAN_BANDS) {
    const box = scanCellBox(45.7753, 4.8497, band.tileDeg);
    const points = boxSamplePoints(box);
    const side = Math.sqrt(points.length);
    assert.equal(side % 1, 0);
    assert.equal(side % 2, 1, 'the grid must be odd');
    const middle = points[(points.length - 1) / 2];
    assert.ok(Math.abs(middle.lat - ((box.north + box.south) / 2)) < 1e-9);
    assert.ok(Math.abs(middle.lon - ((box.east + box.west) / 2)) < 1e-9);
    for (const point of points) {
      assert.ok(point.lat > box.south && point.lat < box.north);
      assert.ok(point.lon > box.west && point.lon < box.east);
    }
  }
});

test('a bigger box is probed more densely, up to the cap', () => {
  const fine = boxSamplePoints(scanCellBox(45.77, 4.85, 0.01));
  const coarse = boxSamplePoints(scanCellBox(45.77, 4.85, 0.04));
  assert.equal(fine.length, 9);
  assert.ok(coarse.length > fine.length);
  assert.ok(coarse.length <= 25, 'the cap bounds what one box spends on the BAN');
});
