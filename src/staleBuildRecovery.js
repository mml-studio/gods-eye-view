/**
 * staleBuildRecovery.js — the one failure a toast cannot fix by being read.
 *
 * WHY THIS EXISTS. Staging rebuilds under open tabs. A page left open across a
 * deploy asks for hashed chunk names the origin no longer serves, so the first
 * toggle of any layer it had not already loaded fails with a 404 the browser
 * remembers for the tab's lifetime. Clicking again cannot work; reloading
 * always does. Until now the app said so in a toast that cleared itself after
 * two seconds — long enough to notice a message, too short to read a fourteen
 * word instruction and act on it (reported 2026-09-14, on the IRVE row).
 *
 * SO THE INSTRUCTION CARRIES ITSELF OUT. A stale build gets a countdown and a
 * reload, not a sentence the reader has to obey by hand. What this module owns
 * is the part that must never be improvised at the call site:
 *
 *  1. WHEN an automatic reload is allowed. A reload that fires on a failure the
 *     reload itself cannot cure is a reload loop, so one is spent per cooldown
 *     window and the next failure inside it only offers the button.
 *  2. WHAT the reloaded page comes back as. The layer the reader clicked is
 *     added to the share hash first, so the reload finishes the click instead
 *     of returning them to the state they were trying to leave.
 *
 * Everything here is pure. The UI owns the timer, the DOM and `location`.
 */

import { LAYER_STATE_REGISTRY } from './data/layerState.js';

/**
 * How long the reader gets to read the notice and stop the reload.
 *
 * Six seconds is the number that lets an unhurried reader finish the sentence
 * AND reach the button, which two (the old toast dwell) did not. It is also
 * short enough that a reader who does nothing is not left staring at a broken
 * layer — the whole point is that doing nothing is the working path.
 */
export const STALE_BUILD_COUNTDOWN_MS = 6000;

/** Dwell for the notice when nothing will happen unless the reader acts. */
export const STALE_BUILD_MANUAL_DWELL_MS = 30000;

/**
 * One automatic reload per ten minutes per tab.
 *
 * The failure mode this guards is a chunk 404 that a reload does NOT cure — an
 * origin that is genuinely missing the file, or an offline tab. Without a
 * cooldown the restored layer fails again on boot and reloads again, forever.
 * Ten minutes is longer than any reload-plus-retry cycle and shorter than the
 * gap between two staging deploys, so a second genuine stale build later in
 * the same tab still gets its automatic recovery.
 */
export const STALE_BUILD_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

/** Per-tab, so the mark survives the reload it is meant to bound. */
export const STALE_BUILD_RELOAD_STORAGE_KEY = 'gev:stale-build-reload-at';

/** Voice states that mean a live session would be cut by a reload. */
const VOICE_BUSY_STATUSES = new Set(['connecting', 'listening', 'executing']);

/**
 * Read the last automatic reload mark without trusting the tab's storage.
 * @param {{getItem: Function}|null} storage Session storage, or null.
 * @returns {number|null} Epoch ms of the last reload, or null when unmarked.
 */
export function readStaleBuildReloadMark(storage) {
  let raw = null;
  try {
    raw = storage?.getItem?.(STALE_BUILD_RELOAD_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Mark a reload as spent. Storage failures are silent: a tab that refuses
 * storage loses the loop guard, so such a tab never gets the automatic path.
 * @param {{setItem: Function}|null} storage Session storage, or null.
 * @param {number} nowMs Epoch ms.
 * @returns {boolean} True when the mark was written.
 */
export function rememberStaleBuildReload(storage, nowMs) {
  try {
    storage?.setItem?.(STALE_BUILD_RELOAD_STORAGE_KEY, String(Math.floor(nowMs)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the tab's one automatic reload, or refuse.
 *
 * SPENDING IS PART OF ASKING. The budget is claimed here, when the countdown
 * starts, not when it fires — a claim that cannot be WRITTEN is not a claim,
 * and a tab whose storage silently drops the mark would reload on every boot
 * forever. So the mark is written and read back, and a tab that fails that
 * round trip (private mode, storage denied) simply never gets the automatic
 * path. Claiming early also means a reader who cancels has still spent the
 * window, which is the honest reading of a reader who said no.
 *
 * Three other ways to answer no, each a different reader: one whose tab spent
 * its reload recently (the loop), one looking at another tab (a countdown
 * nobody can see is not consent), and one mid voice turn (a reload drops the
 * WebRTC session and the turn with it).
 *
 * @param {object} input Decision inputs.
 * @param {{getItem: Function, setItem: Function}|null} [input.storage] Tab storage.
 * @param {number} input.nowMs Epoch ms.
 * @param {string} [input.visibility] `document.visibilityState`.
 * @param {string|null} [input.voiceStatus] `#gev-voice-control` data-status.
 * @returns {boolean} True when an automatic reload was claimed.
 */
export function claimStaleBuildAutoReload({
  storage = null,
  nowMs,
  visibility = 'visible',
  voiceStatus = null,
} = {}) {
  if (visibility !== 'visible') return false;
  if (VOICE_BUSY_STATUSES.has(String(voiceStatus || '').toLowerCase())) return false;
  const mark = readStaleBuildReloadMark(storage);
  // A mark in the future is a clock that moved; treat it as spent rather than
  // as permission that lasts until the clock catches up.
  if (mark !== null && (mark > nowMs || nowMs - mark < STALE_BUILD_RELOAD_COOLDOWN_MS)) return false;
  const stamp = Math.floor(nowMs);
  if (!rememberStaleBuildReload(storage, stamp)) return false;
  return readStaleBuildReloadMark(storage) === stamp;
}

/** Whole seconds still on the clock, never below zero. */
export function staleBuildSecondsLeft(deadlineMs, nowMs) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Notice copy for the two states this recovery can be in.
 *
 * Both name the row's own label rather than the internal id, so the sentence
 * starts with the line the reader just clicked. The manual wording keeps the
 * imperative it had, because in that state the reader really is the one who
 * has to act.
 *
 * @param {object} input Copy inputs.
 * @param {string} input.label Panel label of the layer that failed.
 * @param {'auto'|'manual'} input.mode Whether a reload is already scheduled.
 * @param {number} [input.secondsLeft] Seconds remaining, for `auto`.
 * @returns {string} Toast copy.
 */
export function staleBuildNotice({ label, mode, secondsLeft = 0 }) {
  const name = String(label || 'Cette couche');
  if (mode !== 'auto') return `${name} : code non chargé — recharge la page`;
  if (secondsLeft <= 0) return `${name} : code non chargé — rechargement…`;
  return `${name} : code non chargé — rechargement dans ${secondsLeft} s`;
}

/**
 * Put the layers that failed back into the share hash before reloading.
 *
 * Without this the reader lands on the state they were trying to LEAVE: the
 * click failed, so the layer is off, so the hash says off, so the reload
 * restores it off and they must click again — the reload would have fixed the
 * code and undone the intent in the same motion.
 *
 * Refuses on anything it does not fully understand (no v2 payload, an unknown
 * token) rather than writing a hash the decoder would reject wholesale, which
 * would restore NO layers at all.
 *
 * @param {string} hash Current `window.location.hash`, with or without `#`.
 * @param {Iterable<string>} layerIds Layers whose chunk failed.
 * @param {Array<{id: string, token: string}>} [registry] Share-token registry.
 * @returns {string|null} The hash to write, or null to leave it alone.
 */
export function staleBuildReloadHash(hash, layerIds, registry = LAYER_STATE_REGISTRY) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (params.get('v') !== '2' || !params.has('l')) return null;
  const order = new Map(registry.map((entry, index) => [entry.token, index]));
  const tokens = String(params.get('l') || '').split('.').filter(Boolean);
  // An unknown token already makes the decoder drop the whole layer payload.
  // Rewriting around it would not rescue that link and could mask it.
  if (tokens.some((token) => !order.has(token))) return null;
  const present = new Set(tokens);
  const wanted = new Set(layerIds);
  let changed = false;
  for (const entry of registry) {
    if (!wanted.has(entry.id) || present.has(entry.token)) continue;
    tokens.push(entry.token);
    present.add(entry.token);
    changed = true;
  }
  if (!changed) return null;
  // Registry order, so the written payload matches what the encoder produces
  // on the next debounce rather than reshuffling on first camera move.
  tokens.sort((a, b) => order.get(a) - order.get(b));
  params.set('l', tokens.join('.'));
  return `#${params.toString()}`;
}
