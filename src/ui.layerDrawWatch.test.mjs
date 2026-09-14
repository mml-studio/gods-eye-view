// The one-string seam between a layer that empties itself and the key that
// describes it.
//
// `ui.js` listens for `gev:layer-draw-changed` as a LITERAL, because importing
// the constant would pull `addressScanLayer.js` — and with it Cesium and the
// world overlay — into the entry chunk to read a string. That is the right
// trade and it is also how a rename becomes a silent no-op: the layer fires an
// event nobody hears, the key goes on describing a scene with nothing in it,
// and every unit test still passes. This is the check that fails instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYER_DRAW_CHANGED_EVENT } from './data/addressScanLayer.js';

const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');

test('the shell listens for the event the address layers actually fire', () => {
  assert.equal(LAYER_DRAW_CHANGED_EVENT, 'gev:layer-draw-changed');
  assert.ok(
    ui.includes(`window.addEventListener('${LAYER_DRAW_CHANGED_EVENT}', onDrawChanged)`),
    `ui.js does not listen for ${LAYER_DRAW_CHANGED_EVENT}`,
  );
  assert.ok(
    ui.includes(`window.removeEventListener('${LAYER_DRAW_CHANGED_EVENT}', onDrawChanged)`),
    'the listener is added and never removed',
  );
});

test('the listener asks the manager for a repaint through its public door', () => {
  // `_refreshTogglePanel` is private and names the panel it happens to live in;
  // `refreshControls` names what the caller wants. A shell reaching for the
  // private one would work today and break the first time the panel moves.
  assert.ok(ui.includes('this._dataManager?.refreshControls?.()'), ui.slice(0, 0));
  const manager = readFileSync(new URL('./data/manager.js', import.meta.url), 'utf8');
  assert.match(manager, /^ {2}refreshControls\(\) \{$/m);
});
