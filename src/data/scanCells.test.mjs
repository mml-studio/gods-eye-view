// src/data/scanCells.test.mjs
// The mark a cell draws. Two claims are load-bearing and both are asserted
// rather than trusted: a disc never spills out of its own cell, and the AREA it
// covers is the count it was computed on — not the indicator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_MAX_FILL,
  CELL_MIN_FILL,
  bucketCells,
  cellBand,
  cellClearanceM,
  cellDiscRadiusM,
  cellFill,
  cellSideM,
  discRing,
  medianOf,
} from './scanCells.js';

const BREAKS = [2, 5, 10, 25, 60];
// A geohash-7 cell at Lyon, as the ADEME actually returns them: 107 x 152 m.
const CELL = {
  west: 4.8497, south: 45.7753, east: 4.85107, north: 45.77667,
};

test('the short side is what a fraction is taken of', () => {
  const side = cellSideM(CELL);
  const height = (CELL.north - CELL.south) * 110_540;
  assert.ok(side <= height + 1, 'a non-square cell must yield its SHORT side');
  assert.ok(side > 80 && side < 130, `expected ~107 m, got ${side}`);
});

test('a disc never spills out of its own cell', () => {
  // The rule that keeps a field of cells from becoming an opaque quilt.
  for (const count of [1, 3, 8, 20, 45, 120, 4_000]) {
    const radius = cellDiscRadiusM(CELL, count, BREAKS);
    assert.ok(radius * 2 <= cellSideM(CELL) + 1e-6,
      `${count} drew a ${radius * 2} m disc in a ${cellSideM(CELL)} m cell`);
  }
});

test('an empty cell draws nothing at all', () => {
  assert.equal(cellBand(0, BREAKS), -1);
  assert.equal(cellFill(0, BREAKS), 0);
  assert.equal(cellDiscRadiusM(CELL, 0, BREAKS), 0);
  assert.equal(cellDiscRadiusM(CELL, null, BREAKS), 0);
});

test('the fill is monotone in the count and bounded by the two ceilings', () => {
  let previous = -1;
  for (const count of [1, 2, 5, 10, 25, 60, 10_000]) {
    const fill = cellFill(count, BREAKS);
    assert.ok(fill >= previous, 'a bigger count must never draw a smaller disc');
    assert.ok(fill >= CELL_MIN_FILL && fill <= CELL_MAX_FILL);
    previous = fill;
  }
  assert.equal(cellFill(1, BREAKS), CELL_MIN_FILL);
  assert.equal(cellFill(10_000, BREAKS), CELL_MAX_FILL);
});

test('the classes step evenly in DIAMETER, which is what an eye compares', () => {
  const fills = [1, 2, 5, 10, 25, 60].map((count) => cellFill(count, BREAKS));
  const steps = fills.slice(1).map((fill, index) => fill - fills[index]);
  for (const step of steps) assert.ok(Math.abs(step - steps[0]) < 1e-9);
});

test('the ring is a circle on the ground, not in degrees', () => {
  const ring = discRing(4.85, 45.7753, 100, 64);
  assert.equal(ring.length, 64);
  const toM = ([lon, lat]) => [
    (lon - 4.85) * 111_320 * Math.cos((45.7753 * Math.PI) / 180),
    (lat - 45.7753) * 110_540,
  ];
  for (const point of ring) {
    const [x, y] = toM(point);
    // Within a metre of the radius everywhere: a ring that was round in
    // degrees would be 40 % out on the longitude axis at this latitude.
    assert.ok(Math.abs(Math.hypot(x, y) - 100) < 1, `radius was ${Math.hypot(x, y)}`);
  }
});

test('the clearance grows with the disc and never drops to zero', () => {
  assert.ok(cellClearanceM(0) >= 6);
  assert.ok(cellClearanceM(200) > cellClearanceM(20));
});

test('the grid is anchored on the globe, so cells do not crawl when the box moves', () => {
  const rows = [{ lon: 4.8500, lat: 45.7750 }, { lon: 4.8502, lat: 45.7751 }];
  const wide = bucketCells(rows, {
    south: 45.76, west: 4.84, north: 45.78, east: 4.86,
  }, 150);
  const shifted = bucketCells(rows, {
    south: 45.77, west: 4.845, north: 45.79, east: 4.865,
  }, 150);
  assert.equal(wide.length, 1);
  assert.equal(shifted.length, 1);
  assert.equal(wide[0].key, shifted[0].key);
  assert.equal(wide[0].south, shifted[0].south);
});

test('rows outside the box are dropped, not bucketed', () => {
  const box = { south: 45.77, west: 4.84, north: 45.78, east: 4.86 };
  const cells = bucketCells([
    { lon: 4.85, lat: 45.775 },
    { lon: 4.90, lat: 45.775 },
    { lon: 4.85, lat: 45.900 },
    { lon: Number.NaN, lat: 45.775 },
  ], box, 150);
  assert.equal(cells.reduce((sum, cell) => sum + cell.rows.length, 0), 1);
});

test('a cell stands on its members, not in the middle of its own square', () => {
  // All four sales on one street at the cell's southern edge: the disc has to
  // sit on that street, not in the courtyard behind it.
  const box = { south: 45.77, west: 4.84, north: 45.78, east: 4.86 };
  const cells = bucketCells([
    { lon: 4.8500, lat: 45.77502 },
    { lon: 4.8501, lat: 45.77503 },
    { lon: 4.8502, lat: 45.77502 },
  ], box, 150);
  assert.equal(cells.length, 1);
  const cell = cells[0];
  assert.ok(Math.abs(cell.lat - 45.775023) < 1e-5);
  assert.ok(cell.lat < (cell.north + cell.south) / 2, 'the centroid must beat the centre');
});

test('the median is the middle value, and null for nothing', () => {
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([3]), 3);
  assert.equal(medianOf([1, 3, 2]), 2);
  assert.equal(medianOf([1, 2, 3, 4]), 2.5);
  assert.equal(medianOf([1, Number.NaN, 3]), 2);
});
