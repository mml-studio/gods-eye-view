#!/usr/bin/env node
/**
 * Browser proof for what the Géorisques layer puts ON SCREEN.
 *
 * The complaint this answers, from a live session over the Trocadéro on
 * 2026-09-14: the layer drew one line-art triangle and nothing else, while the
 * eight hazards the same scan had already resolved were rendered by no surface
 * of the globe. Unit tests could not catch either half — the first is a
 * property of a raster, the second of the manager's key, and both live behind
 * a real scan.
 *
 * WHAT IS PROVEN HERE, and why each one needs a browser:
 *
 *   i.   the commune OUTLINE reaches the scene as clamped polylines, closed,
 *        classified onto whichever surface is drawn
 *   ii.  the outline is the commune the scan ran on — 75113, not the 75056 the
 *        report echoes for every Paris arrondissement
 *   iii. the installations are drawn with the filled plate rather than the
 *        line-art triangle, at the sizes the severity ramp asks for
 *   iv.  the KEY carries every hazard verdict, including the two that differ
 *        between the commune and the address, and carries them with no colour
 *        swatch because nothing on the globe is painted for them
 *   v.   above the 12 km ceiling all of it is cleared, key included
 *
 * NOT PROVEN, and deliberately: that any of it PAINTS. No Cesium entity ever
 * rasterises under headless Chrome in this repo — measured down to a control
 * polygon — so this asserts the model and the DOM, never a pixel.
 *
 * Run: node scripts/qa-georisques-commune.mjs --url http://localhost:4173
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');

/** Avenue de France, Paris 13e — the reference address of the storyboard. */
const ADDRESS = { lon: 2.3760, lat: 48.8300 };
const CLOSE_VIEW = { ...ADDRESS, height: 900 };
/** Well above `ADDRESS_SCAN_MAX_ALTITUDE_M`, where the layer must go dormant. */
const REGION_VIEW = { ...ADDRESS, height: 60_000 };

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const chrome = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean).find((candidate) => { try { return fs.existsSync(candidate); } catch { return false; } });

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Draw frames by hand: the governor runs in `requestRenderMode`. */
async function pump(page, frames = 6, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

async function flyTo(page, view) {
  await page.evaluate((lon, lat, height) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.requestRender?.();
  }, view.lon, view.lat, view.height);
  await pump(page, 4, 80);
}

/** What the layer actually put in the scene, by kind. */
async function readDraw(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const entry = gev.dataManager.layers.get('georisques');
    const stats = entry?.module?.getStats?.() || {};
    const source = gev.viewer.dataSources._dataSources
      .find((candidate) => candidate.name === 'georisques' || candidate.entities?.id === 'georisques');
    const entities = source ? source.entities.values : [];
    const kinds = {};
    const plates = [];
    let closedRings = 0;
    let outlineRings = 0;
    for (const entity of entities) {
      const kind = entity.properties?.kind?.getValue?.() ?? 'none';
      kinds[kind] = (kinds[kind] || 0) + 1;
      if (entity.polyline) {
        outlineRings += 1;
        const positions = entity.polyline.positions?.getValue?.(gev.viewer.clock.currentTime) || [];
        const first = positions[0];
        const last = positions[positions.length - 1];
        if (first && last && first.x === last.x && first.y === last.y && first.z === last.z) closedRings += 1;
      }
      if (entity.billboard) {
        plates.push({
          width: entity.billboard.width?.getValue?.() ?? null,
          image: String(entity.billboard.image?.getValue?.() ?? ''),
          hasRamp: Boolean(entity.billboard.scaleByDistance),
        });
      }
    }
    return {
      stats,
      kinds,
      plates,
      outlineRings,
      closedRings,
      entities: entities.length,
      // The key, read from the DOM the reader actually sees.
      legend: [...document.querySelectorAll('.map-legend-entry')].map((node) => ({
        label: node.querySelector('.map-legend-label')?.textContent ?? '',
        blurb: node.querySelector('.map-legend-blurb')?.textContent ?? '',
        unmapped: node.querySelector('.map-legend-swatch')?.classList.contains('is-unmapped') ?? null,
        background: node.querySelector('.map-legend-swatch')?.style.background ?? '',
      })),
      legendNote: document.querySelector('.map-legend-source')?.textContent ?? '',
      legendFootnote: document.querySelector('.map-legend-note')?.textContent ?? '',
    };
  });
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chrome,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  protocolTimeout: 180_000,
});
// `newQaPage` takes the browser and its own options — it does NOT navigate,
// so the `goto` below is on us. It installs the first-run suppression before
// any page script runs, which is why every harness here opens its page through
// it rather than through puppeteer's own constructor.
const page = await newQaPage(browser);
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log(`  [page error] ${error.message}`));

try {
  console.log(`\n— booting ${APP_URL} —`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  let booted = false;
  for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
    booted = await page.evaluate(() => Boolean(window.__godsEyeView?.dataManager));
    if (!booted) await sleep(500);
  }
  check(booted, 'the app booted and published its data manager');
  if (!booted) throw new Error('no boot');

  await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('georisques', true));
  await flyTo(page, CLOSE_VIEW);

  console.log('\n— the scan over avenue de France —');
  // WAIT FOR THE SCAN TO BE THIS ONE, not merely for a scan to exist. The
  // layer is switched on before the camera moves, so its first answer is about
  // the boot view — the 16e, measured — and a harness that stops at the first
  // non-empty draw asserts against the wrong commune while everything works.
  let draw = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    draw = await readDraw(page);
    if (draw.stats.scanCommuneInsee === '75113' && draw.entities > 0 && draw.legend.length > 0) break;
    await pump(page, 2, 120);
  }

  check(draw.outlineRings > 0, 'the commune outline reached the scene',
    `${draw.outlineRings} ring(s), ${draw.entities} entities`);
  check(draw.outlineRings === draw.closedRings,
    'every outline ring is closed, so no gash crosses the commune',
    `${draw.closedRings}/${draw.outlineRings}`);
  check(draw.kinds['commune-outline-label'] === 1,
    'the commune is named on the ground, once');
  check(draw.stats.communeOutlined === true, 'the layer reports the outline it drew');
  check(draw.stats.scanCommuneInsee === '75113',
    'the outline is the ARRONDISSEMENT the scan ran on, not Paris-whole',
    `scan=${draw.stats.scanCommuneInsee} report=${draw.stats.communeInsee}`);

  console.log('\n— the installations —');
  check(draw.plates.length > 0, 'installations are drawn', `${draw.plates.length}`);
  const svgs = draw.plates.map((plate) => Buffer.from(plate.image.split(',')[1] || '', 'base64').toString('utf8'));
  check(svgs.every((svg) => svg.includes('mask="url(#m)"')),
    'every mark is the filled plate, not the line-art triangle');
  check(svgs.every((svg) => !svg.includes('fill="none"')),
    'no mark is drawn as an unfilled stroke');
  check(draw.plates.every((plate) => plate.hasRamp), 'every mark rides the distance ramp');
  check(draw.plates.every((plate) => plate.width >= 18),
    'no mark is drawn below the size a plate stays legible at',
    `min=${Math.min(...draw.plates.map((plate) => plate.width))}`);

  console.log('\n— the key, which is where the verdicts live —');
  const labels = draw.legend.map((entry) => entry.label);
  check(labels.some((label) => label.startsWith('Limite de Paris 13e')),
    'the key names the commune the outline belongs to', labels[0]);
  const hazardLines = draw.legend.filter((entry) => entry.label.includes('—') && !entry.label.startsWith('Limite'));
  check(hazardLines.length >= 6, 'the hazards are keyed', `${hazardLines.length} lines`);
  check(hazardLines.every((entry) => entry.unmapped === true),
    'no hazard carries a colour swatch, because none of them is painted');
  check(labels.some((label) => label.includes('diffère de la commune')),
    'a verdict that differs between commune and address says so in the key');
  const varying = draw.legend.find((entry) => entry.label.includes('diffère de la commune'));
  check(/commune : .+ · à cette adresse : /.test(varying?.blurb || ''),
    'and prints BOTH verdicts under it', varying?.blurb || '(none)');
  check(/Géorisques — BRGM \/ MTE/.test(draw.legendNote),
    'the key carries its provenance', draw.legendNote);
  check(/pas de géométrie/.test(draw.legendFootnote),
    'and says out loud that the hazards are not drawn', draw.legendFootnote);

  console.log('\n— above the ceiling —');
  await flyTo(page, REGION_VIEW);
  let dormant = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    dormant = await readDraw(page);
    if (dormant.stats.dormant === true) break;
    await pump(page, 2, 120);
  }
  check(dormant.stats.dormant === true, 'the layer goes dormant above 12 km');
  check(dormant.outlineRings === 0 && dormant.plates.length === 0,
    'and clears its draw rather than leaving a block-scale answer at region scale',
    `${dormant.entities} entities`);
  check(dormant.legend.length === 0,
    'the key goes with it — a key for a draw that is gone is a lie');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
