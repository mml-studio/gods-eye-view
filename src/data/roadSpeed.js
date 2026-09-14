/**
 * @file Cruising speed for a simulated traffic dot. Reads OSM `maxspeed` as a
 * CEILING over the per-class table — never as a target.
 *
 * The dots are a simulation: TomTom's flow tiles carry a `traffic_level`
 * ratio (current speed / free-flow speed) per segment and nothing else — no
 * vehicle, no position, no absolute speed. Every dot's speed is invented
 * here, then scaled by that ratio.
 *
 * For a long time it was invented from the OSM highway class ALONE, and that
 * was wrong in the one city this fork exists for: Paris has been 30 km/h
 * since 2021, while `highway=primary` (boulevard Saint-Michel, boulevard de
 * Sébastopol…) rendered at 50 km/h base and up to 65 with the spawn noise —
 * roughly twice the legal limit, on a photorealistic aerial view where a
 * viewer can judge the speed against the buildings.
 *
 * The rule is a MINIMUM, not a substitution: `min(class speed, legal limit)`.
 * A limit can only slow a dot down.
 *  - Paris `primary` tagged 30 → 50 becomes 30. The fix we came for.
 *  - A motorway tagged 130 stays at the table's 90, which is the speed people
 *    actually drive. Substituting the limit would have made motorways 44 %
 *    FASTER — a realism regression paid for a realism fix.
 *  - A residential street tagged 30 stays at 18: nobody does 30 in an alley.
 *
 * @module data/roadSpeed
 */

/**
 * Free-flow speed in m/s by OSM `highway` class — approximate speeds actually
 * DRIVEN, not legal limits (see the module note: the limit is the ceiling).
 * @const {Object<string,number>}
 */
export const SPEED_MPS = Object.freeze({
  motorway:     25,   // ~90 km/h
  trunk:        20,   // ~72 km/h
  primary:      14,   // ~50 km/h
  secondary:    11,   // ~40 km/h
  tertiary:     8,    // ~30 km/h
  residential:  5,    // ~18 km/h
  unclassified: 5,
});

/** @const {number} Fallback when the highway class is unknown (m/s). */
const DEFAULT_MPS = SPEED_MPS.unclassified;

/**
 * Implicit `maxspeed` values, in km/h. Keyed by the part after the country
 * prefix, so `FR:urban`, `DE:urban` and a bare `urban` all resolve.
 *
 * `nsl_single`/`nsl_dual` are the UK national speed limits (60/70 mph): this
 * globe is worldwide and a London way tagged `GB:nsl_dual` is common.
 * @const {Object<string,number>}
 */
const IMPLICIT_KMH = Object.freeze({
  walk: 10,
  living_street: 20,
  bicycle_road: 30,
  zone30: 30,
  urban: 50,
  rural: 80,
  trunk: 110,
  motorway: 130,
  nsl_single: 96,   // 60 mph
  nsl_dual: 112,    // 70 mph
});

/**
 * Values that name a speed without giving one. They must fall back to the
 * class table rather than park a dot or launch it: `none` is the German
 * Autobahn (no limit — not "infinitely fast"), `signals`/`variable` mean a
 * gantry decides, `unknown` is a surveyor admitting they did not look.
 * @const {Set<string>}
 */
const UNUSABLE = new Set(['none', 'signals', 'variable', 'unknown', 'no', 'default']);

/** @const {number} Reject anything above this (km/h) as a tagging error. */
const MAX_PLAUSIBLE_KMH = 150;

/**
 * Parse one OSM `maxspeed` value into km/h.
 *
 * Handles the forms that actually occur: a bare number (km/h by convention),
 * `"30 mph"`, `"20 knots"`, implicit codes (`FR:urban`, `DE:zone30`,
 * `GB:nsl_dual`, `zone:30`), and multi-values (`"50;30"` → the SLOWEST, since
 * a dot that respects the strictest posted limit is never the wrong kind of
 * wrong).
 *
 * @param {string|number|null|undefined} raw - Raw tag value.
 * @returns {number|null} Speed in km/h, or null when unusable/implausible.
 */
export function parseMaxspeedKmh(raw) {
  if (typeof raw === 'number') return plausible(raw);
  if (typeof raw !== 'string') return null;

  const text = raw.trim().toLowerCase();
  if (!text) return null;

  // Multi-value: keep the slowest readable branch, ignore unreadable ones.
  if (text.includes(';')) {
    let slowest = null;
    for (const part of text.split(';')) {
      const kmh = parseMaxspeedKmh(part);
      if (kmh !== null && (slowest === null || kmh < slowest)) slowest = kmh;
    }
    return slowest;
  }

  const numeric = text.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|knots)?$/);
  if (numeric) {
    const value = Number(numeric[1]);
    const unit = numeric[2];
    if (unit === 'mph') return plausible(value * 1.609344);
    if (unit === 'knots') return plausible(value * 1.852);
    return plausible(value);
  }

  if (UNUSABLE.has(text)) return null;

  // `DE:zone30`, `FR:zone:30` — read the number rather than enumerate every
  // zone a country can post.
  const zone = text.match(/(?:^|:)zone:?(\d+)$/);
  if (zone) return plausible(Number(zone[1]));

  if (text in IMPLICIT_KMH) return plausible(IMPLICIT_KMH[text]);

  // Country-prefixed: strip the prefix and re-read. `FR:urban` → `urban`,
  // and `zone:maxspeed=FR:30` → a plain 30, which is how that tag is written
  // in the wild.
  if (text.includes(':')) return parseMaxspeedKmh(text.slice(text.indexOf(':') + 1));

  return null;
}

/**
 * Clamp a candidate speed to the plausible band.
 * @param {number} kmh
 * @returns {number|null}
 */
function plausible(kmh) {
  if (!Number.isFinite(kmh) || kmh <= 0 || kmh > MAX_PLAUSIBLE_KMH) return null;
  return kmh;
}

/**
 * Read the posted limit off an OSM tag bag, in km/h.
 *
 * Checks `maxspeed`, then `zone:maxspeed` (how a French/German 30 zone is
 * often tagged when the sign is at the zone entry rather than the street),
 * then `maxspeed:type` (the implicit-limit tag).
 *
 * @param {Object<string,string>|null|undefined} tags - OSM tags.
 * @returns {number|null} Limit in km/h, or null when none is usable.
 */
export function readMaxspeedKmh(tags) {
  if (!tags) return null;
  return parseMaxspeedKmh(tags.maxspeed)
    ?? parseMaxspeedKmh(tags['zone:maxspeed'])
    ?? parseMaxspeedKmh(tags['maxspeed:type']);
}

/**
 * Cruising speed for a road, in m/s: the class table, capped by the posted
 * limit when OSM knows one.
 *
 * @param {string} type - OSM `highway` value.
 * @param {Object<string,string>|null} [tags] - OSM tags of the way.
 * @returns {number} Speed in m/s (always > 0).
 */
export function roadCruiseMps(type, tags = null) {
  const classMps = SPEED_MPS[type] || DEFAULT_MPS;
  const kmh = readMaxspeedKmh(tags);
  if (kmh === null) return classMps;
  return Math.min(classMps, kmh / 3.6);
}
