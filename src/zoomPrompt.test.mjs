import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderZoomPrompt,
  ZOOM_PROMPT_FALLBACK_MESSAGE,
  ZOOM_PROMPT_LEAVE_MS,
  ZOOM_PROMPT_MAX_ROWS,
  zoomPromptMessage,
  zoomPromptModel,
  zoomPromptSentence,
  zoomPromptTitle,
  zoomPromptVisible,
} from './zoomPrompt.js';

const waitingLayer = (id, overrides = {}) => ({
  id,
  label: overrides.label || id,
  enabled: true,
  lifecycleState: 'enabled',
  stats: {
    status: 'zoom-in',
    loadingLabel: `Zoome pour charger ${id}`,
    ...(overrides.stats || {}),
  },
  ...overrides,
});

test('only switched-on layers at a camera gate are announced', () => {
  const model = zoomPromptModel([
    waitingLayer('power-grid', { label: 'Réseau électrique' }),
    { ...waitingLayer('transit-fr'), enabled: false },
    waitingLayer('hubeau-hydro', { stats: { status: 'ok' } }),
    waitingLayer('bruit-fr', { stats: { status: 'empty' } }),
    waitingLayer('cadastre-fr', { stats: { status: 'out-of-gate' } }),
  ]);
  assert.equal(model.total, 1);
  assert.equal(model.rows[0].label, 'Réseau électrique');
  assert.equal(model.signature, 'power-grid');
});

test('too-high and too-wide are the same news as zoom-in', () => {
  const model = zoomPromptModel([
    waitingLayer('cadastre-fr', { stats: { status: 'too-high' } }),
    waitingLayer('bdtopo-buildings', { stats: { status: 'too-wide' } }),
  ]);
  assert.equal(model.total, 2);
});

test('a coordinator with no panel row of its own is not announced', () => {
  assert.equal(zoomPromptModel([
    { ...waitingLayer('military-awareness'), showInTogglePanel: false },
  ]), null);
});

test('a layer mid-load or mid-toggle is not announced', () => {
  assert.equal(zoomPromptModel([
    waitingLayer('power-grid', { stats: { status: 'zoom-in', loading: true } }),
    waitingLayer('transit-fr', { lifecycleState: 'enabling' }),
    waitingLayer('bruit-fr', { lifecycleState: 'disabling' }),
  ]), null);
});

test('nothing waiting means no card at all', () => {
  assert.equal(zoomPromptModel([]), null);
  assert.equal(zoomPromptModel([waitingLayer('power-grid', { stats: { status: 'ok' } })]), null);
});

test('the card caps its rows and counts the rest', () => {
  const model = zoomPromptModel([
    waitingLayer('a'), waitingLayer('b'), waitingLayer('c'), waitingLayer('d'), waitingLayer('e'),
  ]);
  assert.equal(model.rows.length, ZOOM_PROMPT_MAX_ROWS);
  assert.equal(model.hiddenCount, 2);
  assert.equal(model.total, 5);
  assert.equal(model.title, '5 couches attendent un zoom');
  // The signature covers every waiting layer, not only the printed ones: a
  // dismissed card must not come back because a layer past the cap changed.
  assert.equal(model.signature, 'a|b|c|d|e');
});

test('the fly button is offered only where the layer can carry the camera', () => {
  const model = zoomPromptModel(
    [waitingLayer('power-grid'), waitingLayer('transit-fr')],
    { canFly: (id) => id === 'power-grid' },
  );
  assert.deepEqual(model.rows.map((row) => row.canFly), [true, false]);
});

test('the layer supplies the words, and a silent layer still gets a sentence', () => {
  assert.equal(
    zoomPromptMessage({ loadingLabel: 'zoome sous 120 km pour charger le réseau' }),
    'Zoome sous 120 km pour charger le réseau',
  );
  assert.equal(zoomPromptMessage({ error: 'vue trop large' }), 'Vue trop large');
  assert.equal(zoomPromptMessage({}), ZOOM_PROMPT_FALLBACK_MESSAGE);
  assert.equal(zoomPromptSentence('  '), '');
  assert.equal(zoomPromptTitle(1), 'Zoome pour voir cette couche');
});

test('a dismissal is remembered against the situation, not forever', () => {
  const model = zoomPromptModel([waitingLayer('power-grid')]);
  assert.equal(zoomPromptVisible(model, ''), true);
  assert.equal(zoomPromptVisible(model, 'power-grid'), false);
  const next = zoomPromptModel([waitingLayer('power-grid'), waitingLayer('transit-fr')]);
  assert.equal(zoomPromptVisible(next, 'power-grid'), true, 'a new layer waiting is new news');
  assert.equal(zoomPromptVisible(null, ''), false);
});

test('an exclusive surface keeps the card off the screen', () => {
  const model = zoomPromptModel([waitingLayer('power-grid')]);
  assert.equal(zoomPromptVisible(model, '', true), false);
});

// ── Rendering ───────────────────────────────────────────────────────────────

function makeElement(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    dataset: {},
    className: '',
    textContent: '',
    type: '',
    title: '',
    disabled: false,
    hidden: false,
    children: [],
    attributes: {},
    listeners: {},
    ownerDocument: null,
    appendChild(child) { node.children.push(child); return child; },
    replaceChildren(...nodes) { node.children = nodes; },
    setAttribute(name, value) { node.attributes[name] = value; },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    querySelector() { return null; },
    click() { for (const handler of node.listeners.click || []) handler(); },
  };
  return node;
}

function makeHost({ animated = false } = {}) {
  const host = makeElement('div');
  host.ownerDocument = { createElement: (tag) => { const el = makeElement(tag); el.ownerDocument = host.ownerDocument; return el; } };
  // Only a host with a real `classList` takes the fading path; the stubs the
  // manager's unit tests install do not, and hide synchronously.
  if (animated) {
    const classes = new Set();
    host.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  return host;
}

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const text = (host, className) => flatten(host)
  .find((node) => node.className === className)?.textContent || '';

test('rendering without a mount point is a no-op, not a crash', () => {
  assert.equal(renderZoomPrompt(null, zoomPromptModel([waitingLayer('power-grid')])), false);
});

test('a null model empties and hides the card', () => {
  const host = makeHost();
  renderZoomPrompt(host, zoomPromptModel([waitingLayer('power-grid')]));
  assert.equal(host.hidden, false);
  renderZoomPrompt(host, null);
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  assert.equal(host.dataset.signature, '');
});

test('an unchanged situation does not rebuild the card under the cursor', () => {
  const host = makeHost();
  const model = zoomPromptModel([waitingLayer('power-grid')], { canFly: () => true });
  renderZoomPrompt(host, model);
  const firstPaint = host.children;
  renderZoomPrompt(host, zoomPromptModel([waitingLayer('power-grid')], { canFly: () => true }));
  assert.equal(host.children, firstPaint, 'same signature, same nodes');
});

test('the card is rebuilt when its words change, or when a flight ended', () => {
  const host = makeHost();
  const sameSet = () => [waitingLayer('power-grid')];
  renderZoomPrompt(host, zoomPromptModel(sameSet()));
  const firstPaint = host.children;

  // Same layer waiting, different sentence: the situation is unchanged and the
  // dismissal key with it, but the card must not go on printing the old words.
  const reworded = zoomPromptModel([
    waitingLayer('power-grid', { stats: { status: 'zoom-in', loadingLabel: 'Zoome sous 120 km' } }),
  ]);
  assert.equal(reworded.signature, 'power-grid', 'the dismissal key is unmoved');
  renderZoomPrompt(host, reworded);
  assert.notEqual(host.children, firstPaint);
  assert.equal(text(host, 'zoom-prompt-message'), 'Zoome sous 120 km');

  // A failed flight changes nothing else on the card — and would strand its own
  // button on "Zoom en cours…" if the epoch were not part of the render key.
  const afterFlight = zoomPromptModel(sameSet(), { epoch: 1 });
  const beforeFlight = zoomPromptModel(sameSet(), { epoch: 0 });
  assert.notEqual(afterFlight.renderSignature, beforeFlight.renderSignature);
  assert.equal(afterFlight.signature, beforeFlight.signature);
});

test('a flight in progress takes the card off, and a failed one brings it back', () => {
  const model = zoomPromptModel([waitingLayer('power-grid')]);
  assert.equal(zoomPromptVisible(model, '', false, 'power-grid'), false, 'gone on the press');
  // Released when the flight settles. The layer is still gated — the flight did
  // not reach the gate — so the same card is news again.
  assert.equal(zoomPromptVisible(model, '', false, ''), true);
  // A flight for a DIFFERENT situation never silences this one.
  assert.equal(zoomPromptVisible(model, '', false, 'transit-fr'), true);
});

test('the card fades out rather than cutting, and a return cancels the fade', async () => {
  const host = makeHost({ animated: true });
  renderZoomPrompt(host, zoomPromptModel([waitingLayer('power-grid')]));
  renderZoomPrompt(host, null);
  assert.equal(host.classList.contains('zoom-prompt-leaving'), true, 'it is leaving');
  assert.equal(host.hidden, false, 'and still on screen while it does');

  // A card that comes back mid-fade must cancel it, or the pending timer would
  // hide the new one a moment after it appeared.
  renderZoomPrompt(host, zoomPromptModel([waitingLayer('transit-fr')]));
  assert.equal(host.classList.contains('zoom-prompt-leaving'), false);
  await new Promise((resolve) => setTimeout(resolve, ZOOM_PROMPT_LEAVE_MS + 40));
  assert.equal(host.hidden, false, 'the cancelled fade did not hide the new card');

  renderZoomPrompt(host, null);
  await new Promise((resolve) => setTimeout(resolve, ZOOM_PROMPT_LEAVE_MS + 40));
  assert.equal(host.hidden, true);
  assert.equal(host.dataset.signature, '');
  assert.equal(host.children.length, 0);
});

test('the fly button reports its layer once and then refuses to queue a second solve', () => {
  const host = makeHost();
  const flown = [];
  renderZoomPrompt(
    host,
    zoomPromptModel([waitingLayer('power-grid', { label: 'Réseau électrique' })], { canFly: () => true }),
    { onFly: (id) => flown.push(id) },
  );
  const fly = flatten(host).find((node) => node.className === 'zoom-prompt-fly');
  assert.ok(fly, 'a gated layer that can fly has a button');
  fly.click();
  assert.deepEqual(flown, ['power-grid']);
  assert.equal(fly.disabled, true);
  assert.equal(fly.attributes['aria-busy'], 'true');
  // It does not relabel itself: the card is leaving on this press, and a word
  // changing inside a fading card is a flicker.
  assert.equal(fly.textContent, 'Zoomer ici');
  fly.click();
  assert.deepEqual(flown, ['power-grid', 'power-grid'],
    'the stub has no disabled semantics — the guard is `disabled`, asserted above');
});

test('closing the card reports the signature it closed', () => {
  const host = makeHost();
  const dismissed = [];
  renderZoomPrompt(host, zoomPromptModel([waitingLayer('power-grid')]), {
    onDismiss: (signature) => dismissed.push(signature),
  });
  flatten(host).find((node) => node.className === 'zoom-prompt-close').click();
  assert.deepEqual(dismissed, ['power-grid']);
});

test('a layer that cannot fly gets no button, and the overflow is counted', () => {
  const host = makeHost();
  renderZoomPrompt(host, zoomPromptModel(
    [waitingLayer('a'), waitingLayer('b'), waitingLayer('c'), waitingLayer('d')],
  ));
  const nodes = flatten(host);
  assert.equal(nodes.filter((node) => node.className === 'zoom-prompt-fly').length, 0);
  assert.equal(nodes.find((node) => node.className === 'zoom-prompt-more').textContent, '+1 autre couche');
});
