/**
 * @module transitDelayOffset
 *
 * Undo a WHOLE-HOUR clock offset in a GTFS-Realtime feed's published
 * deviations.
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 * `TripUpdate.StopTimeEvent.delay` is a number the OPERATOR computes: predicted
 * time minus scheduled time. A publisher that reads its predictions in UTC and
 * its own `stop_times.txt` in local time gets the two in different frames, and
 * every deviation it publishes is then wrong by the local UTC offset — 7 200 s
 * in French summer time.
 *
 * MEASURED on 2026-09-15 across all 150 feeds of the national index, 64 of
 * which published stop-level deviations. Sixty-three of them sit where you
 * would expect a bus network to sit: medians from 0 to +220 s. The sixty-fourth
 * is `pan-84178`, Rémi — Réseau de Mobilité Interurbaine CVDL, the intercity
 * network covering the whole Centre-Val de Loire:
 *
 *   n = 2 609 stop deviations · p25 −7 210 s · p50 −7 149 s · p75 −7 052 s
 *
 * −7 149 s is −1.986 h. Every coach in Tours, Orléans, Blois, Bourges and
 * Chartres was therefore drawn "118 min early", a thing no bus has ever been,
 * and the card said so on a vehicle parked at a stop it was predicted to reach
 * in one minute. The PREDICTED TIMES in the same body are right (08:04 local
 * for a stop the probe saw at 08:00); only the subtraction is in the wrong
 * frame.
 *
 * ── Why the offset is corrected and not merely suppressed ───────────────────
 * Because a whole number of hours is the only shape this mistake can take, and
 * the residual is the real punctuality. Rémi's residual median is +51 s: the
 * network is running on time, and printing nothing would throw that away.
 *
 * The test is deliberately narrow, because subtracting two hours from an
 * operator's own number is a strong claim. THREE things must hold together:
 * enough readings to have a median at all, a median within five minutes of a
 * whole hour, and a TIGHT interquartile spread. The third is what separates a
 * clock from traffic: Rémi's IQR is 158 s — the whole network shifted by one
 * constant — where a network genuinely running late has deviations that fan
 * out over tens of minutes and no reason to centre on 3 600 s. A feed that
 * fails any of the three is passed through untouched.
 *
 * @see transitSchedule.awaitingDeparture for the OTHER impossible-early case —
 *   a bus on layover at its terminus, which is a real prediction about a real
 *   bus and is reclassified rather than corrected.
 */

/**
 * Stop-level deviations a feed must publish before its median means anything.
 *
 * Forty rather than a handful: the estimate is a median and an interquartile
 * range, and both are noise on a school network reporting six stop times. A
 * feed under this threshold keeps whatever it published.
 */
export const DELAY_OFFSET_MIN_SAMPLES = 40;

/**
 * Largest offset entertained, in whole hours.
 *
 * Twelve covers every UTC offset a French publisher can land on, including the
 * overseas networks (Réunion at +4, Guadeloupe at −4, New Caledonia at +11),
 * and refuses the absurd rest.
 */
export const DELAY_OFFSET_MAX_HOURS = 12;

/**
 * How near a whole hour the median must sit, in seconds.
 *
 * Five minutes. A clock offset is exact; what moves the median off it is the
 * network's own punctuality, and five minutes is more than a French urban
 * operator's median deviation has ever been in this index (the largest
 * measured is 220 s, on TOHM). Wider would start swallowing lateness.
 */
export const DELAY_OFFSET_NEAR_HOUR_SEC = 300;

/**
 * Largest interquartile spread that still reads as ONE clock, in seconds.
 *
 * Fifteen minutes. This is the discriminator, not the median: a constant added
 * to every reading shifts the distribution without widening it (Rémi: 158 s),
 * where a network actually running two hours behind is a network whose buses
 * disagree with each other by far more than that.
 */
export const DELAY_OFFSET_MAX_SPREAD_SEC = 900;

const SECONDS_PER_HOUR = 3600;

/** Every stop-level deviation a feed's trip updates carry, sorted ascending. */
function sortedStopDelays(trips) {
  const out = [];
  for (const trip of Array.isArray(trips) ? trips : []) {
    for (const stop of Array.isArray(trip?.stops) ? trip.stops : []) {
      if (Number.isFinite(stop?.delaySec)) out.push(stop.delaySec);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Value at quantile `p` of an already-sorted array. */
function quantile(sorted, p) {
  return sorted[Math.floor(p * (sorted.length - 1))];
}

/**
 * The whole-hour clock offset a feed's deviations are shifted by, or 0.
 *
 * Reads stop-level deviations only. `TripUpdate.delay` is the spec's own
 * trip-wide fallback and no French network published one on 2026-08-31, so
 * including it could only add a handful of readings to a decision that already
 * needs forty.
 *
 * @param {Array<Object>} trips Normalized trip updates.
 * @returns {number} Seconds to SUBTRACT from every deviation — a signed
 *   multiple of 3 600 — or 0 when the feed shows no clock offset.
 */
export function feedDelayOffsetSec(trips) {
  const delays = sortedStopDelays(trips);
  if (delays.length < DELAY_OFFSET_MIN_SAMPLES) return 0;

  const median = quantile(delays, 0.5);
  const hours = Math.round(median / SECONDS_PER_HOUR);
  if (hours === 0 || Math.abs(hours) > DELAY_OFFSET_MAX_HOURS) return 0;

  const offset = hours * SECONDS_PER_HOUR;
  if (Math.abs(median - offset) > DELAY_OFFSET_NEAR_HOUR_SEC) return 0;

  const spread = quantile(delays, 0.75) - quantile(delays, 0.25);
  if (spread > DELAY_OFFSET_MAX_SPREAD_SEC) return 0;

  return offset;
}

/**
 * Subtract a clock offset from every deviation a feed published.
 *
 * MUTATES the records in place, and must therefore be called exactly once per
 * decoded body — the proxy caches these arrays, and a second pass would shift
 * them twice. Both the stop-level deviations and the trip-level one are moved:
 * they are the same operator's same subtraction in the same wrong frame.
 *
 * @param {Array<Object>} trips Normalized trip updates.
 * @param {number} offsetSec From {@link feedDelayOffsetSec}.
 * @returns {number} How many deviations were corrected.
 */
export function correctTripDelays(trips, offsetSec) {
  if (!Number.isFinite(offsetSec) || offsetSec === 0) return 0;
  let corrected = 0;
  for (const trip of Array.isArray(trips) ? trips : []) {
    if (!trip) continue;
    if (Number.isFinite(trip.delaySec)) {
      trip.delaySec -= offsetSec;
      corrected += 1;
    }
    for (const stop of Array.isArray(trip.stops) ? trip.stops : []) {
      if (!Number.isFinite(stop?.delaySec)) continue;
      stop.delaySec -= offsetSec;
      corrected += 1;
    }
  }
  return corrected;
}

/**
 * The offset as a provenance line, for the panel's feed summary.
 *
 * Named in HOURS because that is the fact — a timezone, not a measurement —
 * and signed the way the correction reads: a feed publishing deviations two
 * hours too EARLY has its clock two hours behind the times it predicts.
 *
 * @param {number} offsetSec
 * @returns {?string} null when there is nothing to say.
 */
export function delayOffsetNotice(offsetSec) {
  if (!Number.isFinite(offsetSec) || offsetSec === 0) return null;
  const hours = Math.abs(offsetSec) / SECONDS_PER_HOUR;
  const plural = hours > 1 ? 's' : '';
  return `deviations corrected: this feed publishes them ${hours} h${plural} `
    + `${offsetSec < 0 ? 'early' : 'late'} against its own predicted times`;
}
