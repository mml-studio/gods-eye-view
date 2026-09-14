// src/data/roadJunctions.test.mjs
// Where two streets actually meet. The signal clock's first version stopped
// dots two segments before the END OF THE WAY, which is not the junction —
// dots froze mid-block while the ones ahead of them drove through the
// crossing. These helpers find the crossing itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeKey, countNodeUses, junctionFlags } from './roadJunctions.js';

const way = (...pts) => ({ type: 'way', geometry: pts.map(([lon, lat]) => ({ lat, lon })) });
const coordsOf = (w) => w.geometry.map((g) => [g.lon, g.lat]);

test('a vertex two ways share is a junction; one way alone is not', () => {
  // A horizontal street crossing a vertical one at (0.001, 0).
  const across = way([0, 0], [0.001, 0], [0.002, 0]);
  const up = way([0.001, -0.001], [0.001, 0], [0.001, 0.001]);
  const uses = countNodeUses([across, up]);

  assert.deepEqual([...junctionFlags(coordsOf(across), uses)], [0, 1, 0]);
  assert.deepEqual([...junctionFlags(coordsOf(up), uses)], [0, 1, 0]);
});

test('a junction INSIDE a way is found — the end-of-way rule could not see it', () => {
  const boulevard = way([0, 0], [0.001, 0], [0.002, 0], [0.003, 0]);
  const side = way([0.002, 0], [0.002, 0.001]);
  const flags = junctionFlags(coordsOf(boulevard), countNodeUses([boulevard, side]));
  assert.equal(flags[2], 1, 'the mid-way crossing is marked');
  assert.equal(flags[0] + flags[1] + flags[3], 0, 'nothing else is');
});

test('two ways that merely pass near each other do not meet', () => {
  // A bridge over a street: no shared vertex, 11 m apart. Correct answer for
  // a grade separation, and the reason this is an exact match, not a radius.
  const under = way([0, 0], [0.002, 0]);
  const over = way([0.001, -0.0001], [0.001, 0.0001]);
  const flags = junctionFlags(coordsOf(under), countNodeUses([under, over]));
  assert.deepEqual([...flags], [0, 0]);
});

test("a closed way's seam is not a junction with itself", () => {
  // A roundabout repeats its first vertex last. Counting both would promote
  // every loop's seam into a crossing nobody can see.
  const loop = way([0, 0], [0.001, 0], [0.001, 0.001], [0, 0]);
  const uses = countNodeUses([loop]);
  assert.equal(uses.get(nodeKey(0, 0)), 1);
  assert.deepEqual([...junctionFlags(coordsOf(loop), uses)], [0, 0, 0, 0]);

  // But a street genuinely joining that loop still makes one.
  const branch = way([0, 0], [-0.001, 0]);
  assert.equal(countNodeUses([loop, branch]).get(nodeKey(0, 0)), 2);
});

test('three ways meeting at one point still read as one junction', () => {
  const a = way([0, 0], [0.001, 0]);
  const b = way([0, 0], [0, 0.001]);
  const c = way([0, 0], [-0.001, 0]);
  const uses = countNodeUses([a, b, c]);
  assert.equal(uses.get(nodeKey(0, 0)), 3);
  assert.equal(junctionFlags(coordsOf(a), uses)[0], 1);
});

test('malformed input yields no junction rather than throwing', () => {
  assert.equal(countNodeUses(null).size, 0);
  assert.equal(countNodeUses([{ type: 'node' }, { type: 'way' }]).size, 0);
  assert.equal(countNodeUses([way([NaN, 0], [1, 1])]).size, 1);
  assert.deepEqual([...junctionFlags(null, new Map())], []);
  assert.deepEqual([...junctionFlags([[0, 0]], null)], [0]);
});

test('the key neither rounds a distinction away nor invents a match', () => {
  // Overpass emits 7 decimals; two nodes 1 cm apart stay distinct.
  assert.notEqual(nodeKey(48.8464001, 2.34), nodeKey(48.8464002, 2.34));
  assert.equal(nodeKey(48.8464, 2.34), nodeKey(48.84640000, 2.3400000));
});
