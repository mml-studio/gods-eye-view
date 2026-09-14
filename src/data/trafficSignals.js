/**
 * @file A global two-phase signal clock for the simulated traffic dots.
 *
 * The tell this exists to kill: on a perpendicular junction, dots crossed
 * from both streets AT THE SAME TIME. There was no junction in the model at
 * all — each dot rides one OSM way end to end, and the only nod to a red
 * light was a 0.8 % per-crossing dice roll near a way's ends, uncorrelated
 * between streets. Two crossing flows simply never saw each other.
 *
 * Real signal timing is not available: TomTom's flow tiles carry a congestion
 * ratio per segment, and OSM's `highway=traffic_signals` nodes would cost a
 * second Overpass request per view and still say nothing about phase. So this
 * approximates the ONE property a viewer actually reads from an aerial view:
 * crossing streets do not move at the same time.
 *
 * Every road is bucketed by its bearing folded into 0–180° — phase 0 for
 * 0–90°, phase 1 for 90–180° — and a single 70 s clock (35 s per phase, an
 * ordinary urban cycle) greens one bucket at a time, globally. Perpendicular
 * streets land in opposite buckets by construction, so they alternate for
 * free, with no per-junction data.
 *
 * What it deliberately does NOT model: a junction's actual geometry, turning
 * movements, or local phase offsets. Two nearly-parallel streets straddling
 * the 90° cut (89° and 91°) land in opposite phases and will alternate as if
 * they crossed. That artefact is rare, near-unreadable at city scale, and far
 * cheaper than the defect it replaces.
 *
 * @module data/trafficSignals
 */

/** @const {number} Full cycle, both phases (ms). Ordinary urban timing. */
export const SIGNAL_CYCLE_MS = 70000;

/** @const {number} One phase's green (ms). */
const HALF_CYCLE_MS = SIGNAL_CYCLE_MS / 2;

/**
 * @const {number} Random start spread (ms) added when a queue releases, so a
 * held platoon pulls away as an accordion instead of one rigid block.
 */
export const SIGNAL_START_JITTER_MS = 1200;

/**
 * @const {number} Shortest stop worth applying (ms). A dot reaching the
 * junction as the light turns green should drive through, not twitch.
 */
export const SIGNAL_MIN_STOP_MS = 800;

/**
 * @const {number} Bumper-to-bumper spacing in a held queue (m). Each further
 * dot stops this much further back from the stop line, so a queue reads as a
 * queue instead of a single over-plotted dot at the junction node.
 */
export const QUEUE_GAP_M = 7;

/**
 * @const {number} How far short of the junction node the FIRST dot stops (m).
 * A stop line sits before the crossing, not on it — and a dot parked exactly
 * on the node is ambiguous both to a viewer and to the crossing counter.
 */
export const STOP_LINE_M = 4;

/**
 * Road classes that never queue at a light. Grade-separated roads have no
 * signalled junctions, and a motorway dot freezing mid-viaduct reads as a
 * rendering bug.
 * @const {Set<string>}
 */
const SIGNALLESS_TYPES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

/**
 * Overall bearing of a way, folded to 0–180° (a street has an orientation,
 * not a direction — north-south is one axis whichever way you drive it).
 *
 * Taken between the first and last vertex: this classifies a street's AXIS,
 * which is what the phase bucket needs, so the cost is one atan2 per way at
 * parse time and zero per frame. A curving street is approximated by its
 * chord, and a closed loop (first vertex == last) returns null.
 *
 * @param {number[][]} coords - `[lon, lat]` pairs, at least two.
 * @returns {number|null} Bearing in [0, 180), or null when undefined.
 */
export function wayBearingDeg(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) return null;

  const [lon1, lat1] = first;
  const [lon2, lat2] = last;
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;

  // Equirectangular approximation: at street scale the meridian convergence
  // is irrelevant, and the cosine correction is what keeps an east-west
  // street in Paris from reading as diagonal.
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  if (dx === 0 && dy === 0) return null;

  const deg = Math.atan2(dx, dy) * 180 / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/**
 * Bucket a bearing into a signal phase.
 * @param {number|null} bearingDeg - Bearing in [0, 180).
 * @returns {0|1|null} Phase, or null for a non-finite bearing.
 */
export function bearingPhase(bearingDeg) {
  if (!Number.isFinite(bearingDeg)) return null;
  const folded = ((bearingDeg % 180) + 180) % 180;
  return folded < 90 ? 0 : 1;
}

/**
 * The signal phase a road obeys, or null when it has no signalled junctions.
 *
 * @param {string} type - OSM `highway` value.
 * @param {number[][]} coords - `[lon, lat]` pairs.
 * @param {Object<string,string>|null} [tags] - OSM tags of the way.
 * @returns {0|1|null}
 */
export function roadSignalPhase(type, coords, tags = null) {
  if (SIGNALLESS_TYPES.has(type)) return null;
  // A roundabout is the opposite of a signal: it exists to keep flows moving
  // without one, so its dots must never freeze.
  if (tags?.junction === 'roundabout' || tags?.junction === 'circular') return null;
  return bearingPhase(wayBearingDeg(coords));
}

/**
 * Which phase holds the green right now.
 * @param {number} nowMs - Epoch milliseconds.
 * @param {number} [cycleMs=SIGNAL_CYCLE_MS] - Full cycle length.
 * @returns {0|1}
 */
export function greenPhase(nowMs, cycleMs = SIGNAL_CYCLE_MS) {
  const half = cycleMs / 2;
  return Math.floor(nowMs / half) % 2 === 0 ? 0 : 1;
}

/**
 * When the current red ends for a phase.
 *
 * @param {number} nowMs - Epoch milliseconds.
 * @param {0|1|null} phase - The road's phase.
 * @param {number} [cycleMs=SIGNAL_CYCLE_MS] - Full cycle length.
 * @returns {number} Epoch ms at which the light turns green, or 0 when the
 *   phase already holds the green (or has no signal at all).
 */
export function redEndsAt(nowMs, phase, cycleMs = SIGNAL_CYCLE_MS) {
  if (phase !== 0 && phase !== 1) return 0;
  if (greenPhase(nowMs, cycleMs) === phase) return 0;
  const half = cycleMs / 2;
  return (Math.floor(nowMs / half) + 1) * half;
}
