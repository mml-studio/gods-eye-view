// src/data/roadSpeed.test.mjs
// The OSM `maxspeed` ceiling. The contract has one shape: a posted limit can
// only SLOW a dot down. Substituting it outright would have made motorways
// 44 % faster — a realism regression bought with a realism fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaxspeedKmh, readMaxspeedKmh, roadCruiseMps, SPEED_MPS } from './roadSpeed.js';

const kmh = (mps) => mps * 3.6;

// ── the defect this shipped for ─────────────────────────────

test('a Paris primary tagged 30 renders at 30, not 50', () => {
  // Boulevard Saint-Michel: highway=primary, limited to 30 km/h since 2021.
  assert.equal(Math.round(kmh(roadCruiseMps('primary', { maxspeed: '30' }))), 30);
  // Untagged, it keeps the class table exactly — no silent change elsewhere.
  assert.equal(roadCruiseMps('primary', {}), SPEED_MPS.primary);
  assert.equal(roadCruiseMps('primary', null), SPEED_MPS.primary);
});

test('a limit never speeds a dot UP', () => {
  // 130 on a motorway is the legal ceiling; 90 is what people drive.
  assert.equal(roadCruiseMps('motorway', { maxspeed: '130' }), SPEED_MPS.motorway);
  // Nobody does 30 in an alley either.
  assert.equal(roadCruiseMps('residential', { maxspeed: '30' }), SPEED_MPS.residential);
  // A 110 trunk stays at the table's 72 km/h.
  assert.equal(roadCruiseMps('trunk', { maxspeed: 'FR:trunk' }), SPEED_MPS.trunk);
});

test('an unknown highway class still gets a speed', () => {
  assert.ok(roadCruiseMps('service', null) > 0);
  assert.equal(roadCruiseMps('service', { maxspeed: '10' }), 10 / 3.6);
});

// ── parsing the tag zoo ─────────────────────────────────────

test('bare numbers are km/h, units are honoured', () => {
  assert.equal(parseMaxspeedKmh('50'), 50);
  assert.equal(parseMaxspeedKmh(30), 30);
  assert.equal(parseMaxspeedKmh('30 km/h'), 30);
  assert.equal(Math.round(parseMaxspeedKmh('30 mph')), 48);
  assert.equal(Math.round(parseMaxspeedKmh('20 knots')), 37);
});

test('implicit codes resolve with or without a country prefix', () => {
  assert.equal(parseMaxspeedKmh('FR:urban'), 50);
  assert.equal(parseMaxspeedKmh('urban'), 50);
  assert.equal(parseMaxspeedKmh('DE:zone30'), 30);
  assert.equal(parseMaxspeedKmh('FR:zone:30'), 30);
  assert.equal(parseMaxspeedKmh('walk'), 10);
  assert.equal(parseMaxspeedKmh('GB:nsl_dual'), 112);
});

test('a multi-value keeps the SLOWEST readable branch', () => {
  assert.equal(parseMaxspeedKmh('50;30'), 30);
  assert.equal(parseMaxspeedKmh('30;50'), 30);
  // An unreadable branch must not poison a readable one.
  assert.equal(parseMaxspeedKmh('none;30'), 30);
  assert.equal(parseMaxspeedKmh('none;signals'), null);
});

test('a tag that names no speed falls back to the class table', () => {
  // `none` is the German Autobahn — no limit, NOT infinite speed.
  for (const unusable of ['none', 'signals', 'variable', 'unknown', '', '  ', 'nonsense']) {
    assert.equal(parseMaxspeedKmh(unusable), null, unusable);
  }
  assert.equal(roadCruiseMps('motorway', { maxspeed: 'none' }), SPEED_MPS.motorway);
});

test('implausible values are refused rather than driven', () => {
  assert.equal(parseMaxspeedKmh('0'), null);
  assert.equal(parseMaxspeedKmh('-30'), null);
  assert.equal(parseMaxspeedKmh('900'), null);   // a decimal point away from 90
  assert.equal(parseMaxspeedKmh('151'), null);
  assert.equal(parseMaxspeedKmh(NaN), null);
  assert.equal(parseMaxspeedKmh(undefined), null);
});

// ── which tag is read ───────────────────────────────────────

test('zone:maxspeed and maxspeed:type are read when maxspeed is absent', () => {
  assert.equal(readMaxspeedKmh({ 'zone:maxspeed': 'FR:30' }), 30);
  assert.equal(readMaxspeedKmh({ 'maxspeed:type': 'FR:zone30' }), 30);
  // `maxspeed` wins when present.
  assert.equal(readMaxspeedKmh({ maxspeed: '50', 'zone:maxspeed': 'FR:30' }), 50);
  assert.equal(readMaxspeedKmh({}), null);
  assert.equal(readMaxspeedKmh(null), null);
});
