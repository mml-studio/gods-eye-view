#!/usr/bin/env node
/**
 * qa-dvf-row — what the « Prix de l'immobilier » row actually says and draws.
 *
 * Four things, all of them regressions the 2026-09-14 rework was about and
 * none of them provable from a unit test:
 *
 *   1. THE KEY FITS. The block used to run off the bottom of the right rail
 *      before its first colour; this measures its height and its entry count.
 *   2. THE FILTER MOVES THE MAP. Pressing « Maisons » has to change how many
 *      billboards are on the globe — that is the whole complaint it answers.
 *   3. THE PLOTS ARE DRAWN. One classified polygon per parcel the register
 *      named, under the markers.
 *   4. NOTHING THROWS on the way.
 *
 * Reads the MODEL, never the pixels: no Cesium entity ever paints in headless
 * Chrome here, so counting entities is the only honest assertion. Screenshots
 * are opt-in behind `--shots` for the same reason.
 *
 * Usage: node scripts/qa-dvf-row.mjs [--url http://localhost:5199] [--shots]
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv;
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:5199';
const shots = argv.includes('--shots');
// Rue des Basques, Bayonne — the address the whole rework was reported from.
const VIEW = { lon: -1.47597, lat: 43.48896, height: 900 };

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
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 120_000 });

  await page.evaluate((view) => {
    const gev = window.__godsEyeView;
    gev.viewer.camera.cancelFlight();
    const ell = gev.viewer.scene.globe.ellipsoid;
    gev.viewer.camera.setView({
      destination: ell.cartographicToCartesian({
        longitude: view.lon * Math.PI / 180,
        latitude: view.lat * Math.PI / 180,
        height: view.height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2.2, roll: 0 },
    });
  }, VIEW);
  await page.evaluate(async () => {
    await window.__godsEyeView.dataManager.setEnabled('dvf-sales', true, { origin: 'user' });
  });
  await page.waitForFunction(
    () => (window.__godsEyeView.dataManager.layers.get('dvf-sales')?.module?.getStats?.()?.count || 0) > 0,
    { timeout: 120_000 },
  );

  const read = () => page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('dvf-sales').module;
    const source = gev.viewer.dataSources.getByName?.('dvf-sales')?.[0]
      || [...Array(gev.viewer.dataSources.length).keys()]
        .map((i) => gev.viewer.dataSources.get(i))
        .find((ds) => [...ds.entities.values].some((e) => String(e.id).startsWith('dvf')));
    const values = source ? [...source.entities.values] : [];
    const rail = document.getElementById('map-legend-items');
    const block = [...(rail?.querySelectorAll('.map-legend-group') || [])]
      .find((node) => /Prix de l/.test(node.textContent || ''))
      || rail?.querySelector('.map-legend-group');
    return {
      stats: module.getStats(),
      controls: module.getRowControls?.() ?? null,
      billboards: values.filter((entity) => entity.billboard).length,
      polygons: values.filter((entity) => entity.polygon).length,
      polylines: values.filter((entity) => entity.polyline).length,
      legendText: rail?.textContent?.trim() || '',
      // SCROLL HEIGHT AGAINST CLIENT HEIGHT, never the bounding box. The rail
      // scrolls: `#map-legend-items` is capped and its box height saturates at
      // the cap, so a key three screens long and a key that fits measure the
      // same. What a reader experiences is the OVERFLOW — how much of the key
      // is below the fold — and that is the only number worth asserting on.
      legendHeight: rail ? Math.round(rail.scrollHeight) : null,
      legendVisible: rail ? Math.round(rail.clientHeight) : null,
      railHeight: Math.round(window.innerHeight),
      entries: rail ? rail.querySelectorAll('.map-legend-entry').length : null,
      inline: rail ? rail.querySelectorAll('.map-legend-inline').length : null,
      bar: rail ? rail.querySelectorAll('.map-legend-bar-segment').length : null,
      note: block?.querySelector('.map-legend-note')?.textContent?.trim() || '',
      source: block?.querySelector('.map-legend-source')?.textContent?.trim() || '',
    };
  });

  const all = await read();
  console.log(`\n  commune ${all.stats.commune} · ${all.stats.salesFound} ventes · `
    + `${all.stats.parcelsDrawn} parcelles · médian ${all.stats.referenceMedianPrixM2} €/m²`);
  check(all.billboards > 0, 'markers are drawn', `${all.billboards}`);
  check(all.polygons > 0, 'the plots are washed under them', `${all.polygons} polygones`);
  check(all.polylines > 0, 'and each plot has its own boundary', `${all.polylines}`);
  check(all.bar > 0, 'the classes read as one distribution bar', `${all.bar} segments`);
  check(all.inline >= 1, 'the classes sit side by side, not stacked');
  check(/médian de/i.test(all.source), 'the denominator frames the classes', all.source.slice(0, 90));
  check(/300 m/.test(all.note), 'the A5 line is under them', all.note.slice(0, 110));
  // A BUDGET, NOT « FITS », because the rail's cap is a fraction of the
  // window and this harness runs at 900 px where it is ~250. What is under
  // this layer's control is the CONTENT height, so that is what is asserted;
  // the overflow is printed beside it so a regression is legible either way.
  // 300 px is roughly the DVF block as it stands (222) plus a line of slack.
  check(all.legendHeight !== null && all.legendHeight <= 300,
    'the price key alone stays under 300px of content',
    `${all.legendHeight}px, ${Math.max(0, all.legendHeight - all.legendVisible)}px below the fold`);

  // 2. THE FILTER.
  await page.evaluate(() => window.__godsEyeView.dataManager
    .setLayerParams('dvf-sales', { type: 'Maison' }, { origin: 'user' }));
  await new Promise((r) => setTimeout(r, 1_500));
  const houses = await read();
  check(houses.billboards < all.billboards,
    'pressing « Maisons » takes the flats off the map',
    `${all.billboards} → ${houses.billboards}`);
  check(houses.stats.referenceMedianPrixM2 === all.stats.referenceMedianPrixM2,
    'and the denominator does not move with it (C1)');
  check(/Filtre/.test(houses.controls?.note || ''),
    'the filter says how many it is hiding', (houses.controls?.note || '').slice(0, 110));

  await page.evaluate(() => window.__godsEyeView.dataManager
    .setLayerParams('dvf-sales', { type: 'tous' }, { origin: 'user' }));
  await new Promise((r) => setTimeout(r, 1_500));
  const back = await read();
  check(back.billboards === all.billboards, 'and « Toutes » puts them back',
    `${back.billboards}`);

  // THE ROW CARRIES TWO BLOCKS, AND THAT IS THE CASE THAT BROKE. With the
  // estimate on, the rail held the price ramp AND nine exclusion rows with a
  // paragraph each; the operator's screenshot shows the second block's first
  // line clipped by the bottom of the screen.
  await page.evaluate(async () => {
    await window.__godsEyeView.dataManager.setEnabled('avis-valeur', true, { origin: 'user' });
  });
  await page.waitForFunction(
    () => (window.__godsEyeView.dataManager.layers.get('avis-valeur')?.module
      ?.getRowControls?.()?.legend?.length || 0) > 0,
    { timeout: 120_000 },
  );
  await new Promise((r) => setTimeout(r, 2_000));
  const both = await read();
  check(/Estimation GEV/.test(both.legendText), 'the estimate publishes its own block');
  // 828 px was the measurement that started this; 550 is the ceiling the
  // rework has to keep, and it is the number to move if the block grows again.
  check(both.legendHeight !== null && both.legendHeight <= 550,
    'and both blocks together stay under 550px — 828px was the fault',
    `${both.legendHeight}px, ${Math.max(0, both.legendHeight - both.legendVisible)}px below the fold`);

  check(errors.length === 0, 'nothing threw', errors.slice(0, 3).join(' | '));

  if (shots) {
    mkdirSync(new URL('../qa-shots', import.meta.url), { recursive: true });
    // CLIPPED TO THE RAIL, not the viewport. A full-page capture of a scene
    // carrying 397 billboards and 251 classified polygons outlasts the
    // protocol timeout under software GL — the trap `newQaPage`'s own notes
    // record — and the rail is the half of this change a picture can show.
    const clip = await page.evaluate(() => {
      const rail = document.getElementById('map-legend');
      if (!rail) return null;
      const box = rail.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(box.x) - 6), y: Math.max(0, Math.floor(box.y) - 6),
        width: Math.ceil(box.width) + 12, height: Math.ceil(box.height) + 12,
      };
    });
    try {
      await page.screenshot({
        path: new URL('../qa-shots/dvf-legend.png', import.meta.url).pathname,
        ...(clip ? { clip } : {}),
      });
      console.log('  shot → qa-shots/dvf-legend.png');
    } catch (error) { console.log(`  shot failed: ${error.message}`); }
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
