// The correction subtracts two hours from an operator's own published number,
// so these tests are mostly about what it must REFUSE to touch. The shapes
// below are the measured ones: Rémi's real distribution on 2026-09-15, and the
// ordinary French networks it has to be told apart from.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correctTripDelays,
  DELAY_OFFSET_MAX_SPREAD_SEC,
  DELAY_OFFSET_MIN_SAMPLES,
  delayOffsetNotice,
  feedDelayOffsetSec,
} from './transitDelayOffset.js';

/**
 * One trip update carrying `delays` as stop-level deviations.
 * @param {number[]} delays
 */
function tripWith(delays, extra = {}) {
  return {
    tripId: 'T1',
    stops: delays.map((delaySec, i) => ({ sequence: i, stopId: `S${i}`, delaySec })),
    ...extra,
  };
}

/**
 * A sample of 201 deviations with an EXACT median and interquartile spread.
 *
 * Three blocks rather than a ramp, so `p25`, `p50` and `p75` land on chosen
 * values instead of on whatever a uniform ramp's integer indices round to.
 * The detector is a threshold test on those three numbers, and a fixture that
 * misses a bound by half a second would pin nothing.
 */
function fleet(median, iqr) {
  const out = [];
  for (let i = 0; i <= 200; i += 1) {
    if (i <= 50) out.push(median - iqr / 2);
    else if (i < 150) out.push(median);
    else out.push(median + iqr / 2);
  }
  return out;
}

test('the measured Rémi distribution is read as a two-hour clock offset', () => {
  // p25 -7210, p50 -7149, p75 -7052 over 2 609 readings (pan-84178, 2026-09-15):
  // an interquartile spread of 158 s around a median 51 s off two whole hours.
  assert.equal(feedDelayOffsetSec([tripWith(fleet(-7149, 158))]), -7200);
});

test('correcting it leaves the real punctuality behind, not zero', () => {
  // The residual IS the answer: Rémi's median lands at +51 s — on time, which
  // is a different statement from "no deviation published".
  const trips = [tripWith([-7149, -7210, -7052]), { tripId: 'T2', delaySec: -7149, stops: [] }];
  const corrected = correctTripDelays(trips, -7200);
  assert.equal(corrected, 4);
  assert.deepEqual(trips[0].stops.map((s) => s.delaySec), [51, -10, 148]);
  assert.equal(trips[1].delaySec, 51);
});

test('an ordinary French network is left exactly as published', () => {
  // Divia: median 0, IQR 0..15. Le SURF: median 121. TOHM: median 220, the
  // largest in the index. None of them may be touched.
  for (const centre of [0, 121, 220, -60]) {
    assert.equal(feedDelayOffsetSec([tripWith(fleet(centre, 200))]), 0, `centre ${centre}`);
  }
});

test('a network genuinely running two hours behind keeps its lateness', () => {
  // The discriminator is the SPREAD, not the median. Real lateness fans out:
  // half an hour of interquartile spread is twice the ceiling, so this feed
  // keeps its own numbers even though its median is a whole hour away.
  assert.equal(feedDelayOffsetSec([tripWith(fleet(7200, 1800))]), 0);
});

test('the spread ceiling is the line, and it is inclusive', () => {
  // Sitting exactly on the ceiling still reads as one clock; past it, not.
  // Pinned because this bound is the whole safety argument.
  const atCeiling = fleet(-3600, DELAY_OFFSET_MAX_SPREAD_SEC);
  assert.equal(feedDelayOffsetSec([tripWith(atCeiling)]), -3600);
  const overCeiling = fleet(-3600, DELAY_OFFSET_MAX_SPREAD_SEC + 2);
  assert.equal(feedDelayOffsetSec([tripWith(overCeiling)]), 0);
});

test('a median that is not near a whole hour is not a clock', () => {
  // 40 minutes off is a feed with a different problem, and inventing an hour
  // for it would print a number nobody can defend.
  assert.equal(feedDelayOffsetSec([tripWith(fleet(-2400, 60))]), 0);
});

test('too few readings decide nothing', () => {
  const sample = fleet(-7149, 158);
  const short = sample.slice(0, DELAY_OFFSET_MIN_SAMPLES - 1);
  assert.equal(feedDelayOffsetSec([tripWith(short)]), 0);
  // The same readings, one more of them: the threshold is a count, not a shape.
  assert.equal(feedDelayOffsetSec([tripWith(sample)]), -7200);
});

test('an absurd offset is refused rather than applied', () => {
  // A feed whose reference timetable is a day out is broken in a way an hour
  // of arithmetic cannot rescue; `MAX_PLAUSIBLE_DELAY_SEC` already drops the
  // worst of it, and what survives must not be legitimised here.
  assert.equal(feedDelayOffsetSec([tripWith(fleet(-46800, 60))]), 0);
});

test('a feed with no deviations at all is inert', () => {
  assert.equal(feedDelayOffsetSec([]), 0);
  assert.equal(feedDelayOffsetSec(null), 0);
  assert.equal(feedDelayOffsetSec([{ tripId: 'T', stops: [{ sequence: 0 }] }]), 0);
  assert.equal(correctTripDelays(null, -7200), 0);
  assert.equal(correctTripDelays([tripWith([1, 2])], 0), 0);
});

test('a correction of zero changes nothing, and a real one is named in hours', () => {
  assert.equal(delayOffsetNotice(0), null);
  assert.equal(delayOffsetNotice(null), null);
  assert.match(delayOffsetNotice(-7200), /2 hs? early/);
  assert.match(delayOffsetNotice(3600), /1 h late/);
});
