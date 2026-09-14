#!/usr/bin/env node
/**
 * qa-scan-cells — the altitude regime switch, on the view that prompted it.
 *
 * The complaint this answers, in the reader's words: « y a qu'un pan de la vue
 * qui est dessiné ». Below 600 m that pan is the right answer and this harness
 * asserts it is still drawn as before; above 600 m the layers must change UNIT
 * — one disc per patch of ground, over the whole box — and that is the part no
 * unit test can see, because it depends on the camera, the shell's scan guard
 * and the proxy all agreeing.
 *
 * What is checked, in order:
 *   1. LOW: both layers draw their points and their scanned edge.
 *   2. HIGH: both switch to cells, the key changes with them, and the ground
 *      covered goes up by more than an order of magnitude.
 *   3. The boundary is a BOX up high and a CIRCLE down low.
 *   4. Panning inside one tile does not re-ask the question.
 *   5. Nothing throws on the way.
 *
 * Reads the MODEL, never the pixels: no Cesium entity ever paints in headless
 * Chrome here (see `docs/` and the other qa-* harnesses), so entity counts and
 * published stats are the only honest assertions.
 *
 * Usage: node scripts/qa-scan-cells.mjs [--url http://localhost:5199]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv;
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:5199';
// Lyon 6e, rue Garibaldi — the exact view of the screenshot the work started from.
const LON = 4.84979;
const LAT = 45.77535;
const LAYERS = ['dvf-sales', 'dpe-fr'];

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900',
    '--enable-unsafe-swiftshader',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1440, height: 900 });
  // A COLD VITE DEV SERVER COMPILES THE WHOLE GRAPH ON THE FIRST REQUEST, and
  // the default 30 s navigation budget is shorter than that on this app.
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 120_000 });

  const park = (height, lon = LON, lat = LAT) => page.evaluate((view) => {
    const gev = window.__godsEyeView;
    // The boot cinematic outlives a bare `setView` — cancel it first.
    gev.viewer.camera.cancelFlight();
    const ell = gev.viewer.scene.globe.ellipsoid;
    gev.viewer.camera.setView({
      destination: ell.cartographicToCartesian({
        longitude: (view.lon * Math.PI) / 180,
        latitude: (view.lat * Math.PI) / 180,
        height: view.height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2.2, roll: 0 },
    });
    // `setView` IS INSTANTANEOUS AND FIRES NOTHING. These layers scan on
    // `camera.moveEnd`, so a harness that only parks the camera measures the
    // answer from wherever it parked LAST — which is how this file first
    // reported that the cell regime never engaged when in fact it was never
    // asked to. The one thing a real camera stop does that `setView` does not
    // is raise the event, so the harness raises it.
    gev.viewer.camera.moveEnd.raiseEvent();
  }, { lon, lat, height });

  const read = () => page.evaluate((ids) => {
    const gev = window.__godsEyeView;
    const out = {};
    for (const id of ids) {
      const module = gev.dataManager.layers.get(id)?.module;
      let source = null;
      for (let i = 0; i < gev.viewer.dataSources.length; i += 1) {
        const candidate = gev.viewer.dataSources.get(i);
        if ([...candidate.entities.values].some((e) => String(e.id).startsWith(`${id.split('-')[0]}`))) {
          source = candidate;
        }
      }
      const values = source ? [...source.entities.values] : [];
      const cells = values.filter((e) => String(e.id).includes('-cell:') && e.polygon);
      const edge = values.find((e) => String(e.id).endsWith(':scan-edge'));
      const edgePositions = edge?.polyline?.positions?.getValue?.(gev.viewer.clock.currentTime);
      out[id] = {
        stats: module?.getStats?.() ?? null,
        controls: module?.getRowControls?.() ?? null,
        entities: values.length,
        billboards: values.filter((e) => e.billboard).length,
        cells: cells.length,
        hasEdge: Boolean(edge),
        // A box outline is densified to 96 points, a circle to 96 too — so the
        // two are told apart by SHAPE, not by count: a box's corners are right
        // angles, a circle has no corner. The cheap discriminator is whether
        // every vertex sits at the same distance from the centroid.
        edgeRoundness: (() => {
          if (!edgePositions || edgePositions.length < 8) return null;
          const xs = edgePositions.map((p) => p.x);
          const ys = edgePositions.map((p) => p.y);
          const zs = edgePositions.map((p) => p.z);
          const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
          const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
          const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
          const radii = edgePositions.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz));
          return Math.min(...radii) / Math.max(...radii);
        })(),
      };
    }
    return out;
  }, LAYERS);

  const settle = async (ms = 6_000) => { await new Promise((r) => setTimeout(r, ms)); };
  /**
   * Wait for both layers to be answering in the regime asked for.
   *
   * A FIXED SLEEP IS NOT ENOUGH and this file learned it the expensive way: the
   * DVF box scan probes the BAN nine times and may download six commune-year
   * editions, so a cold first visit takes far longer than a warm one and a
   * twelve-second settle reported "the cell regime never engaged" for a regime
   * that engaged at second fourteen.
   */
  const awaitRegime = (basis) => page.waitForFunction((ids, want) => ids.every((id) => {
    const stats = window.__godsEyeView.dataManager.layers.get(id)?.module?.getStats?.() || {};
    return want === 'cells'
      ? stats.scanBasis === 'cells'
      : (stats.scanBasis !== 'cells' && (stats.count || 0) > 0);
  }), { timeout: 240_000 }, LAYERS, basis);

  // ── 1. LOW: the disc regime, unchanged ──────────────────────────────────
  await park(420);
  for (const id of LAYERS) {
    await page.evaluate(
      async (layer) => window.__godsEyeView.dataManager.setEnabled(layer, true, { origin: 'user' }),
      id,
    );
  }
  await awaitRegime('points');
  await settle(2_000);
  const low = await read();
  for (const id of LAYERS) {
    check(low[id].billboards > 0, `${id} · low · draws one mark per subject`,
      `${low[id].billboards} billboards`);
    check(low[id].cells === 0, `${id} · low · draws no cells`);
    check(low[id].hasEdge, `${id} · low · the scanned edge is drawn`);
    check(low[id].edgeRoundness !== null && low[id].edgeRoundness > 0.97,
      `${id} · low · and the edge is a circle`, `roundness ${low[id].edgeRoundness?.toFixed(3)}`);
    check(low[id].stats?.scanBasis !== 'cells', `${id} · low · stats say the disc regime`);
  }

  // ── 2. HIGH: the cell regime ────────────────────────────────────────────
  await park(1_322);
  await awaitRegime('cells');
  await settle(2_000);
  const high = await read();
  for (const id of LAYERS) {
    check(high[id].cells > 0, `${id} · high · draws cells over the box`,
      `${high[id].cells} cellules`);
    check(high[id].billboards === 0, `${id} · high · and no per-subject marks`,
      `${high[id].billboards}`);
    check(high[id].stats?.scanBasis === 'cells', `${id} · high · stats say the cell regime`,
      String(high[id].stats?.scanBasis));
    check(high[id].hasEdge, `${id} · high · the aggregated box is outlined`);
    check(high[id].edgeRoundness !== null && high[id].edgeRoundness < 0.95,
      `${id} · high · and the edge is a box, not a circle`,
      `roundness ${high[id].edgeRoundness?.toFixed(3)}`);
    const legend = high[id].controls?.legend || [];
    check(legend.length > 0, `${id} · high · the key describes the cells`,
      `${legend.length} entrées`);
    check(/agrégée/.test(high[id].controls?.note || ''),
      `${id} · high · the A5 line says what was aggregated`,
      (high[id].controls?.note || '').slice(0, 120));
  }
  const lowSales = low['dvf-sales'].stats?.salesFound || 0;
  const highSales = high['dvf-sales'].stats?.salesFound || 0;
  check(highSales > lowSales * 5, 'the box answers for far more ground than the disc',
    `${lowSales} ventes dans 300 m → ${highSales} dans la boîte`);
  const lowDpe = low['dpe-fr'].stats?.diagnosticsServed || 0;
  const highDpe = high['dpe-fr'].stats?.diagnosticsTotal || 0;
  check(highDpe > lowDpe * 5, 'and the DPE covers the view instead of 200 m',
    `${lowDpe} servis → ${highDpe} agrégés`);
  check(Number.isFinite(high['dpe-fr'].stats?.poorShare)
    && Number.isFinite(high['dpe-fr'].stats?.poorShareNational),
    'the passoire share is published for the view, WITH its national anchor',
    `${high['dpe-fr'].stats?.poorShare} % (registre national `
      + `${high['dpe-fr'].stats?.poorShareNational} %)`);

  // ── 3. Panning inside one tile must not re-ask ──────────────────────────
  const stamps = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id,
    window.__godsEyeView.dataManager.layers.get(id)?.module?.getStats?.()?.lastUpdate ?? null,
  ])), LAYERS);
  const before = await stamps();
  // A tenth of a tile on each axis: inside the same snapped box, so the
  // question is byte-identical and the shell must answer it from what is drawn.
  await park(1_322, LON + 0.0012, LAT + 0.0008);
  await settle(9_000);
  const after = await stamps();
  for (const id of LAYERS) {
    check(before[id] !== null && before[id] === after[id],
      `${id} · panning inside the tile re-uses the answer already drawn`,
      `lastUpdate ${before[id]} → ${after[id]}`);
  }

  // ── 4. Back down: the points come back ──────────────────────────────────
  await park(420);
  await awaitRegime('points');
  await settle(2_000);
  const back = await read();
  for (const id of LAYERS) {
    check(back[id].billboards > 0, `${id} · back down · the per-subject marks return`,
      `${back[id].billboards}`);
    check(back[id].cells === 0, `${id} · back down · and the cells are gone`);
  }

  const fatal = errors.filter((message) => !/ResizeObserver|Failed to load resource/.test(message));
  check(fatal.length === 0, 'nothing threw', fatal.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
