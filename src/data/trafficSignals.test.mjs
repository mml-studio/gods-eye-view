// src/data/trafficSignals.test.mjs
// The two-phase signal clock. Its whole job is one property: two streets that
// cross must not be green at the same instant. Everything else here defends
// the cases where freezing a dot would read as a bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wayBearingDeg,
  bearingPhase,
  roadSignalPhase,
  greenPhase,
  redEndsAt,
  SIGNAL_CYCLE_MS,
} from './trafficSignals.js';

const HALF = SIGNAL_CYCLE_MS / 2;

// ── the property the whole module exists for ────────────────

test('perpendicular streets ALWAYS land in opposite phases', () => {
  // Exhaustive over the folded bearing circle: adding 90° must flip the
  // bucket, at every orientation, or two crossing flows share a green.
  for (let deg = 0; deg < 180; deg += 0.5) {
    const a = bearingPhase(deg);
    const b = bearingPhase(deg + 90);
    assert.notEqual(a, b, `${deg}° and ${deg + 90}° shared a phase`);
  }
});

test('a street is one axis whichever way you drive it', () => {
  const northSouth = [[2.34, 48.84], [2.34, 48.85]];
  const southNorth = [[2.34, 48.85], [2.34, 48.84]];
  assert.equal(roadSignalPhase('primary', northSouth), roadSignalPhase('primary', southNorth));
});

test('a Paris junction: the boulevard and the cross street alternate', () => {
  // Boulevard Saint-Michel (roughly north-south) vs rue Soufflot (east-west),
  // at place Edmond-Rostand.
  const stMichel = [[2.3437, 48.8534], [2.3379, 48.8404]]; // ~16deg, NNE-SSW
  const soufflot = [[2.3459, 48.8462], [2.3407, 48.8465]]; // ~95deg, E-W
  const phaseA = roadSignalPhase('primary', stMichel);
  const phaseB = roadSignalPhase('secondary', soufflot);
  assert.notEqual(phaseA, phaseB);

  // And at any instant exactly one of them is held.
  const now = Date.parse('2026-09-14T06:05:41Z');
  const heldA = redEndsAt(now, phaseA) > 0;
  const heldB = redEndsAt(now, phaseB) > 0;
  assert.notEqual(heldA, heldB);
});

// ── bearing ─────────────────────────────────────────────────

test('bearing is folded into 0-180 and reads the cardinal axes', () => {
  assert.equal(Math.round(wayBearingDeg([[0, 0], [0, 1]])), 0);     // due north
  assert.equal(Math.round(wayBearingDeg([[0, 0], [1, 0]])), 90);    // due east
  assert.equal(Math.round(wayBearingDeg([[0, 1], [0, 0]])), 0);     // due south → same axis
  assert.equal(Math.round(wayBearingDeg([[1, 0], [0, 0]])), 90);    // due west  → same axis
});

test('the latitude correction keeps an east-west street east-west', () => {
  // At 48.8°N a degree of longitude is 0.66 of a degree of latitude. Without
  // the cosine term this 2:3 span would read as a diagonal, not as east-west.
  const parisEastWest = [[2.30, 48.85], [2.33, 48.85]];
  assert.equal(Math.round(wayBearingDeg(parisEastWest)), 90);
});

test('a bearing that cannot be defined is not invented', () => {
  assert.equal(wayBearingDeg([[2.34, 48.84], [2.34, 48.84]]), null); // zero length
  assert.equal(wayBearingDeg([[2.34, 48.84]]), null);                // one vertex
  assert.equal(wayBearingDeg([]), null);
  assert.equal(wayBearingDeg(null), null);
  assert.equal(wayBearingDeg([[NaN, 48.84], [2.34, 48.85]]), null);
  assert.equal(bearingPhase(null), null);
  assert.equal(bearingPhase(NaN), null);
});

// ── roads that must never be held ───────────────────────────

test('grade-separated roads have no signal phase', () => {
  const span = [[2.30, 48.80], [2.35, 48.85]];
  for (const type of ['motorway', 'motorway_link', 'trunk', 'trunk_link']) {
    assert.equal(roadSignalPhase(type, span), null, type);
  }
  // Ordinary streets do.
  assert.notEqual(roadSignalPhase('primary', span), null);
});

test('a roundabout is never held — it exists to avoid a signal', () => {
  const arc = [[2.295, 48.873], [2.296, 48.874]];
  assert.equal(roadSignalPhase('primary', arc, { junction: 'roundabout' }), null);
  assert.equal(roadSignalPhase('secondary', arc, { junction: 'circular' }), null);
});

test('a closed loop has no axis, so it never holds', () => {
  const loop = [[2.34, 48.84], [2.35, 48.85], [2.34, 48.84]];
  assert.equal(roadSignalPhase('residential', loop), null);
});

// ── the clock ───────────────────────────────────────────────

test('exactly one phase is green at a time, and they alternate', () => {
  const base = 1000 * HALF; // an exact phase boundary
  assert.equal(greenPhase(base), 0);
  assert.equal(greenPhase(base + HALF - 1), 0);
  assert.equal(greenPhase(base + HALF), 1);
  assert.equal(greenPhase(base + SIGNAL_CYCLE_MS), 0);
});

test('a red ends at the next phase boundary, a green never starts one', () => {
  const base = 1000 * HALF; // phase 0 green
  assert.equal(redEndsAt(base, 0), 0);              // green: no hold
  assert.equal(redEndsAt(base, 1), base + HALF);    // red: held to the boundary
  assert.equal(redEndsAt(base + HALF - 1, 1), base + HALF);
  // A dot held at t and released at the boundary waits at most one green.
  assert.ok(redEndsAt(base + 1, 1) - base <= HALF);
});

test('a road with no phase is never held', () => {
  assert.equal(redEndsAt(Date.now(), null), 0);
  assert.equal(redEndsAt(Date.now(), undefined), 0);
});
