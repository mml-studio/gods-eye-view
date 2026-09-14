import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  STALE_BUILD_COUNTDOWN_MS,
  STALE_BUILD_MANUAL_DWELL_MS,
  STALE_BUILD_RELOAD_COOLDOWN_MS,
  STALE_BUILD_RELOAD_STORAGE_KEY,
  claimStaleBuildAutoReload,
  readStaleBuildReloadMark,
  rememberStaleBuildReload,
  staleBuildNotice,
  staleBuildReloadHash,
  staleBuildSecondsLeft,
} from './staleBuildRecovery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    read: (key) => (map.has(key) ? map.get(key) : null),
  };
}

test('an unmarked visible tab may reload itself once', () => {
  const storage = fakeStorage();
  assert.equal(claimStaleBuildAutoReload({ storage, nowMs: 1_000_000 }), true);
  rememberStaleBuildReload(storage, 1_000_000);
  assert.equal(storage.read(STALE_BUILD_RELOAD_STORAGE_KEY), '1000000');
  assert.equal(readStaleBuildReloadMark(storage), 1_000_000);
});

test('the spent reload bounds the next one for a full cooldown', () => {
  const storage = fakeStorage();
  rememberStaleBuildReload(storage, 1_000_000);
  // The reloaded page fails the same way on boot: this is the loop the
  // cooldown exists to stop, so the second failure gets the button only.
  assert.equal(claimStaleBuildAutoReload({ storage, nowMs: 1_002_000 }), false);
  assert.equal(
    claimStaleBuildAutoReload({ storage, nowMs: 1_000_000 + STALE_BUILD_RELOAD_COOLDOWN_MS - 1 }),
    false,
  );
  // A later deploy under the same tab still gets its automatic recovery.
  assert.equal(
    claimStaleBuildAutoReload({ storage, nowMs: 1_000_000 + STALE_BUILD_RELOAD_COOLDOWN_MS }),
    true,
  );
});

test('a mark in the future reads as spent rather than as permission', () => {
  const storage = fakeStorage({ [STALE_BUILD_RELOAD_STORAGE_KEY]: '9000000' });
  assert.equal(claimStaleBuildAutoReload({ storage, nowMs: 1_000_000 }), false);
});

test('a corrupt or absent mark never blocks the first reload', () => {
  assert.equal(readStaleBuildReloadMark(fakeStorage({ [STALE_BUILD_RELOAD_STORAGE_KEY]: 'soon' })), null);
  assert.equal(readStaleBuildReloadMark(fakeStorage({ [STALE_BUILD_RELOAD_STORAGE_KEY]: '0' })), null);
  assert.equal(readStaleBuildReloadMark(null), null);
  assert.equal(
    claimStaleBuildAutoReload({
      storage: fakeStorage({ [STALE_BUILD_RELOAD_STORAGE_KEY]: 'soon' }),
      nowMs: 1_000_000,
    }),
    true,
  );
});

test('a tab that refuses storage never reloads itself', () => {
  // Without the mark there is no loop guard, and an unguarded automatic
  // reload is worse than the failure it is curing.
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(claimStaleBuildAutoReload({ storage: throwing, nowMs: 1_000_000 }), false);
  assert.equal(claimStaleBuildAutoReload({ storage: null, nowMs: 1_000_000 }), false);
  assert.equal(rememberStaleBuildReload(throwing, 1_000_000), false);
});

test('a hidden tab and a live voice turn both withhold the automatic reload', () => {
  const nowMs = 1_000_000;
  assert.equal(
    claimStaleBuildAutoReload({ storage: fakeStorage(), nowMs, visibility: 'hidden' }),
    false,
  );
  for (const voiceStatus of ['connecting', 'listening', 'executing', 'LISTENING']) {
    assert.equal(
      claimStaleBuildAutoReload({ storage: fakeStorage(), nowMs, voiceStatus }),
      false,
      `voice ${voiceStatus} must not be cut by an unasked reload`,
    );
  }
  for (const voiceStatus of ['idle', 'error', null]) {
    assert.equal(claimStaleBuildAutoReload({ storage: fakeStorage(), nowMs, voiceStatus }), true);
  }
});

test('the countdown names the row and never prints a negative second', () => {
  assert.equal(
    staleBuildNotice({ label: 'Bornes de recharge', mode: 'auto', secondsLeft: 6 }),
    'Bornes de recharge : code non chargé — rechargement dans 6 s',
  );
  assert.equal(
    staleBuildNotice({ label: 'Bornes de recharge', mode: 'auto', secondsLeft: 0 }),
    'Bornes de recharge : code non chargé — rechargement…',
  );
  assert.equal(
    staleBuildNotice({ label: 'Bornes de recharge', mode: 'manual' }),
    'Bornes de recharge : code non chargé — recharge la page',
  );
  assert.equal(staleBuildSecondsLeft(1_000_000, 1_000_000 + 5_000), 0);
  assert.equal(staleBuildSecondsLeft(1_006_000, 1_000_001), 6);
  assert.equal(staleBuildSecondsLeft(1_006_000, 1_005_999), 1);
});

test('the reload carries the failed layer back ON', () => {
  // `9` is irve-fr. The click failed, so the live hash says OFF; reloading on
  // that hash would fix the code and undo the intent in the same motion.
  const next = staleBuildReloadHash('#v=2&lat=44.6&lon=-1.1&l=f.md', ['irve-fr']);
  const params = new URLSearchParams(next.slice(1));
  assert.equal(params.get('l').split('.').includes('9'), true);
  assert.equal(params.get('lat'), '44.6');
  // Registry order, so the payload matches what the encoder writes next.
  assert.deepEqual(params.get('l').split('.'), ['f', '9', 'md']);
});

test('the reload leaves a hash it cannot read in one piece alone', () => {
  // An unknown token already makes the decoder drop the whole layer payload;
  // rewriting around it cannot rescue the link and could hide the break.
  assert.equal(staleBuildReloadHash('#v=2&l=zzz', ['irve-fr']), null);
  assert.equal(staleBuildReloadHash('#v=1&l=f', ['irve-fr']), null);
  assert.equal(staleBuildReloadHash('#lat=44.6&lon=-1.1', ['irve-fr']), null);
  assert.equal(staleBuildReloadHash('', ['irve-fr']), null);
  // Already on: nothing to write, so the address is left untouched.
  assert.equal(staleBuildReloadHash('#v=2&l=9', ['irve-fr']), null);
  // An empty payload is the valid explicit-empty case, and still accepts one.
  assert.equal(staleBuildReloadHash('#v=2&l=', ['irve-fr']), '#v=2&l=9');
});

test('several dead rows merge into one reload that restores them all', () => {
  const next = staleBuildReloadHash('#v=2&l=', ['irve-fr', 'schools-fr']);
  const tokens = new URLSearchParams(next.slice(1)).get('l').split('.');
  assert.equal(tokens.includes('9'), true);
  assert.equal(tokens.length, 2);
});

test('the toast owns a message node and an action button', () => {
  assert.match(html, /<div id="toast"[^>]*role="status"[\s\S]*?id="toast-message"[\s\S]*?id="toast-action"[^>]*hidden/);
  // An ordinary toast must never eat a globe click: only the acting one takes
  // pointer events back.
  assert.match(css, /#toast \{[\s\S]*?pointer-events: none;/);
  assert.match(css, /#toast\.has-action\.visible \{\s*pointer-events: auto;\s*\}/);
});

test('the stale-build notice outlives the two-second report dwell', () => {
  assert.equal(STALE_BUILD_COUNTDOWN_MS >= 5000, true);
  assert.equal(STALE_BUILD_MANUAL_DWELL_MS >= 15000, true);
  // The countdown stays up until it fires; only the manual notice expires.
  assert.match(ui, /durationMs: auto \? Infinity : STALE_BUILD_MANUAL_DWELL_MS/);
  // The address is the only thing a reload restores from, and it trails the
  // screen by the share debounce.
  assert.match(ui, /flushHash\?\.\(\);\s*\n\s*const nextHash = staleBuildReloadHash/);
  // Every path spends the budget, manual included.
  assert.match(ui, /rememberStaleBuildReload\(this\._sessionStorageRef\(\), Date\.now\(\)\);/);
});
