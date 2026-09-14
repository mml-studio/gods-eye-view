// The manager's half of the zoom card (`src/zoomPrompt.js`): the card is painted
// from the same pass that paints the panel rows, the button reaches the layer's
// own `ensureViewGate()`, and a dismissal survives a repaint of the same
// situation without outliving it.
//
// Headless, like the rest of manager.test.mjs: a stub `document` with the one
// mount point the card looks for. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayerManager } from './manager.js';

function makeElement(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    className: '',
    dataset: {},
    textContent: '',
    type: '',
    title: '',
    disabled: false,
    hidden: false,
    attributes: {},
    listeners: {},
    ownerDocument: null,
    classList: { toggle() {}, contains() { return false; } },
    appendChild(child) { node.children.push(child); return child; },
    replaceChildren(...nodes) { node.children = nodes; },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    querySelector() { return null; },
    click() { for (const handler of node.listeners.click || []) handler(); },
  };
  return node;
}

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const find = (host, className) => flatten(host).find((node) => node.className === className);
const text = (host, className) => find(host, className)?.textContent || '';

function installDocument(host) {
  const original = globalThis.document;
  const doc = {
    createElement: (tag) => { const el = makeElement(tag); el.ownerDocument = doc; return el; },
    getElementById: (id) => (id === 'zoom-prompt' ? host : null),
    body: { classList: { contains: () => false } },
  };
  host.ownerDocument = doc;
  globalThis.document = doc;
  return () => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  };
}

function gatedLayer(id, { status = 'zoom-in', loadingLabel = `Zoome pour ${id}`, canFly = false } = {}) {
  const flights = [];
  const module = {
    id,
    name: id,
    icon: '',
    source: 'test',
    updateInterval: -1,
    async init() {},
    enable() {},
    disable() {},
    async update() {},
    getStats() { return { count: 0, lastUpdate: null, status, loadingLabel }; },
  };
  if (canFly) {
    module.ensureViewGate = async (viewer) => { flights.push(viewer); return true; };
  }
  return { module, flights };
}

async function managerWithLayer(layer) {
  const mgr = new DataLayerManager({ id: 'viewer' });
  mgr.register(layer.module);
  await mgr.setEnabled(layer.module.id, true);
  return mgr;
}

test('a switched-on layer at its gate is announced in the middle of the screen', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const layer = gatedLayer('power-grid', { loadingLabel: 'Zoome sous 120 km pour charger le réseau' });
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(mgr.refreshZoomPrompt(), true);
    assert.equal(host.hidden, false);
    assert.equal(text(host, 'zoom-prompt-title'), 'Zoome pour voir cette couche');
    assert.equal(text(host, 'zoom-prompt-message'), 'Zoome sous 120 km pour charger le réseau');
  } finally {
    await mgr.destroyAll();
    restore();
  }
});

test('a layer that is not at a gate leaves the screen alone', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const layer = gatedLayer('power-grid', { status: 'ok' });
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(mgr.refreshZoomPrompt(), false);
    assert.equal(host.hidden, true);
  } finally {
    await mgr.destroyAll();
    restore();
  }
});

test('the button reaches the layer own view gate, with the manager viewer', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const layer = gatedLayer('power-grid', { canFly: true });
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(mgr.canLayerFlyToGate('power-grid'), true);
    mgr.refreshZoomPrompt();
    find(host, 'zoom-prompt-fly').click();
    assert.equal(await mgr.ensureLayerViewGate('power-grid'), true);
    assert.ok(layer.flights.length >= 1, 'the layer solver ran');
    assert.deepEqual(layer.flights.at(-1), { id: 'viewer' });
  } finally {
    await mgr.destroyAll();
    restore();
  }
});

test('a gate that throws is reported as a refusal, not as an unhandled rejection', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const layer = gatedLayer('power-grid', { canFly: true });
  layer.module.ensureViewGate = async () => { throw new Error('no camera'); };
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(await mgr.ensureLayerViewGate('power-grid'), false);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    await mgr.destroyAll();
    restore();
  }
});

test('a layer without a view gate is never offered a button', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const layer = gatedLayer('transit-fr');
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(mgr.canLayerFlyToGate('transit-fr'), false);
    assert.equal(await mgr.ensureLayerViewGate('transit-fr'), false);
    mgr.refreshZoomPrompt();
    assert.equal(find(host, 'zoom-prompt-fly'), undefined);
  } finally {
    await mgr.destroyAll();
    restore();
  }
});

test('closing the card survives a repaint of the same situation', async () => {
  const host = makeElement();
  const restore = installDocument(host);
  const layer = gatedLayer('power-grid');
  const mgr = await managerWithLayer(layer);
  try {
    mgr.refreshZoomPrompt();
    find(host, 'zoom-prompt-close').click();
    assert.equal(host.hidden, true);
    assert.equal(mgr.refreshZoomPrompt(), false, 'the same layers waiting is the same news');
    // The gate clears, then bites again: that is a new situation, and the card
    // comes back rather than staying closed for the session.
    layer.module.getStats = () => ({ count: 4, lastUpdate: null, status: 'ok' });
    assert.equal(mgr.refreshZoomPrompt(), false);
    layer.module.getStats = () => ({ count: 0, lastUpdate: null, status: 'zoom-in', loadingLabel: 'Zoome' });
    assert.equal(mgr.refreshZoomPrompt(), true);
  } finally {
    await mgr.destroyAll();
    restore();
  }
});

test('a document without the mount point is not a crash', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement: () => makeElement() };
  const layer = gatedLayer('power-grid');
  const mgr = await managerWithLayer(layer);
  try {
    assert.equal(mgr.refreshZoomPrompt(), false);
  } finally {
    await mgr.destroyAll();
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
