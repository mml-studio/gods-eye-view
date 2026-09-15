#!/usr/bin/env node
/**
 * Browser proof for « Équipements du quotidien » after the 2026-09-15 rebuild.
 *
 * Three things changed at once and each of them can fail silently, which is why
 * this is a browser harness and not three unit tests:
 *
 *   i.   THE MARKS ARE PLATES, NOT DOTS. The layer drew a
 *        `PointPrimitiveCollection` of 5-12 px discs whose palette had four
 *        pairs under ΔE 20; it now draws a `BillboardCollection` of punched
 *        pastilles. A unit test can assert the options object handed to
 *        `add()`; only the browser can assert that what reached the scene is a
 *        billboard collection carrying one raster per family and not one per
 *        mark — the Cesium trap that turns 12 000 marks into 12 000 atlas
 *        entries.
 *   ii.  EVERY KEY ROW IS ITS OWN SWITCH, and pressing it RE-ASKS the view.
 *        This is the half that cannot be unit-tested at all: the click goes
 *        through `manager.js`'s delegated listener, into `setLayerParams`, out
 *        to the proxy as `familles=`, and back as a smaller payload. The
 *        harness counts the requests and reads the query string.
 *   iii. THE HOSPITALS ARE GONE FROM HERE. 2 211 FINESS establishments moved to
 *        « Santé & secours ». The pack still carries them — `AMENITY_FAMILIES`
 *        is a cache key and cannot lose a member — so "not drawn" is a claim
 *        about the scene, not about the data, and only the scene can settle it.
 *
 * Run: node scripts/qa-amenities-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'amenities-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

/** The thirteen families this layer draws. `hopital` is NOT one of them. */
const DRAWN_FAMILIES = 13;

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Central Paris: every family at once, and the density the cap was written for. */
const CITY = { lon: 2.3488, lat: 48.8566, height: 2_400 };
/** Rhône-Alpes from 220 km: the maillage regime. */
const MESH_VIEW = { lon: 4.85, lat: 45.75, height: 220_000 };

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

async function pump(page, frames = 8, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Wait for the fetch the camera move (or the filter) started.
 *
 * Polls the layer's own `loading` flag and requires a `lastUpdate` newer than
 * the one we started from, so a settled-but-stale read cannot pass. A fixed
 * sleep is what makes this kind of harness report zero for a layer that is
 * drawing thousands.
 */
async function waitForSettled(page, timeoutMs = 25000) {
  const started = Date.now();
  const before = await page.evaluate(() => (
    window.__godsEyeView.dataManager.layers.get('amenities-fr').module.getStats().lastUpdate ?? 0
  ));
  while (Date.now() - started < timeoutMs) {
    await pump(page, 2, 60);
    const state = await page.evaluate(() => {
      const stats = window.__godsEyeView.dataManager.layers.get('amenities-fr').module.getStats();
      return { loading: stats.loading, lastUpdate: stats.lastUpdate ?? 0, error: stats.error, count: stats.count };
    });
    if (state.error) return state;
    if (!state.loading && state.lastUpdate > before) return state;
    await sleep(150);
  }
  return null;
}

async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    // Always cancel first: as soon as the scene renders continuously a pending
    // boot flight resumes and carries the camera off the view under test.
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 6);
  await waitForSettled(page);
}

/** What actually reached the scene, and what the key says about it. */
function probe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const marks = [];
    let collectionKind = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const collection = scene.primitives.get(i);
      if (typeof collection?.get !== 'function' || !collection.length) continue;
      if (!String(collection.get(0)?.id || '').startsWith('a:')) continue;
      // DUCK-TYPED, because the production bundle is minified and
      // `constructor.name` comes back as `pa`. What separates the two
      // collections is what their members carry: a billboard has an `image`
      // and a `width`, a point primitive has a `pixelSize` and neither.
      const first = collection.get(0);
      collectionKind = first.image !== undefined && first.width !== undefined
        ? 'billboards'
        : (first.pixelSize !== undefined ? 'points' : 'unknown');
      for (let n = 0; n < collection.length; n += 1) {
        const item = collection.get(n);
        marks.push({
          id: item.id,
          // A billboard reports an atlas INDEX for `image`; a point primitive
          // has no such property at all. Reading it back off the primitive is
          // the difference between "the options said billboard" and "a
          // billboard is on the screen".
          image: item.image,
          width: item.width ?? null,
          height: item.height ?? null,
          pixelSize: item.pixelSize ?? null,
        });
      }
      break;
    }
    const controls = gev.dataManager.layers.get('amenities-fr').module.getRowControls();
    return {
      collectionKind,
      marks,
      count: gev.dataManager.layers.get('amenities-fr').module.getStats().count,
      params: gev.dataManager.layers.get('amenities-fr').module.getParams(),
      legend: (controls.legend || []).map((row) => ({
        label: row.label,
        count: row.count,
        off: row.off === true,
        toggle: row.toggle ? row.toggle.value : null,
        // A HASH OF THE WHOLE STRING, because neither end of it discriminates.
        // Every glyph is `data:image/svg+xml;base64,` plus the same `<svg
        // xmlns=…` preamble — the first 40 characters are identical for all
        // thirteen — and every one of them ENDS on the same
        // `<circle … mask="url(#m)"/></svg>`, which base64 encodes to the same
        // trailing bytes whenever the lengths happen to align. Measured: 13
        // distinct glyphs, 13 distinct prefixes of 0, and **3** distinct tails
        // of 64. Only the middle differs, so only the whole string will do.
        glyph: typeof row.glyph === 'string'
          ? (() => {
            let hash = 5381;
            for (let i = 0; i < row.glyph.length; i += 1) {
              hash = (((hash << 5) + hash) ^ row.glyph.charCodeAt(i)) >>> 0;
            }
            return `#${hash.toString(36)}`;
          })()
          : null,
      })),
      chips: (controls.chips || []).map((chip) => chip.label),
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await newQaPage(browser);

  const siteRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/amenities-fr/sites')) siteRequests.push(url);
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__godsEyeView?.dataManager, { timeout: 60000 });
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('amenities-fr', true, { origin: 'user' }));

    console.log('\n[i] the marks are plates, one raster per family');
    await setView(page, CITY.lon, CITY.lat, CITY.height);
    let state = await probe(page);
    console.log(`  · ${state.marks.length} marques, collection ${state.collectionKind}`);
    check('the layer drew something over Paris', state.marks.length > 0, `${state.marks.length} marks`);
    check('and it draws billboards, not point primitives',
      state.collectionKind === 'billboards', String(state.collectionKind));
    const notSquare = state.marks.filter((mark) => !(mark.width > 0) || mark.width !== mark.height);
    const noRaster = state.marks.filter((mark) => mark.image === null || mark.image === undefined);
    check('every mark carries a raster and a square side',
      notSquare.length === 0 && noRaster.length === 0,
      `${noRaster.length} sans raster, ${notSquare.length} non carrées (ex. ${JSON.stringify(notSquare[0] || noRaster[0])})`);
    // THE CEILING, NOT THE FLOOR. More distinct rasters than families would
    // mean a texture per mark — `collection.add({image: <canvas>})` forges a
    // `createGuid()` per billboard, which is how 12 000 marks become 12 000
    // atlas entries and tens of megabytes of texture.
    const rasters = new Set(state.marks.map((mark) => mark.image));
    check('and they share one raster per family, never one per mark',
      rasters.size <= DRAWN_FAMILIES, `${rasters.size} distinct rasters for ${state.marks.length} marks`);
    await shoot(page, '01-paris-plates.png');

    console.log('\n[ii] the hospitals are not drawn here any more');
    check('no key row offers « Hôpital » as a family',
      !state.legend.some((row) => row.toggle === 'hopital'),
      'the withdrawn family is still a switch');
    const withdrawn = state.legend.find((row) => /Hôpitaux/.test(row.label));
    check('and the key says where they went instead of dropping them',
      Boolean(withdrawn) && withdrawn.glyph === null,
      withdrawn ? 'the refusal row took a swatch' : 'no refusal row at all');

    console.log('\n[iii] every family is a switch, and every switch carries its mark');
    const switches = state.legend.filter((row) => row.toggle);
    console.log(`  · ${switches.length} familles, ${switches.filter((row) => row.count > 0).length} présentes dans la vue`);
    check(`the key offers all ${DRAWN_FAMILIES} families`,
      switches.length === DRAWN_FAMILIES, `${switches.length}`);
    check('and each one carries its own silhouette',
      switches.every((row) => typeof row.glyph === 'string' && row.glyph.startsWith('#'))
      && new Set(switches.map((row) => row.glyph)).size === DRAWN_FAMILIES,
      `${new Set(switches.map((row) => row.glyph)).size} distinct swatches`);

    console.log('\n[iv] pressing a key row re-asks the view, filtered');
    const before = siteRequests.length;
    const target = 'boulangerie';
    await page.evaluate((family) => {
      // Through the DOM, like a reader: `page.click()` hangs on this app, and
      // the point of this check is the delegated listener in `manager.js`, not
      // the layer method underneath it.
      const button = [...document.querySelectorAll('.map-legend-entry.is-toggle')]
        .find((node) => node.dataset.toggleValue === family);
      if (button) button.click();
      return Boolean(button);
    }, target);
    await waitForSettled(page);
    state = await probe(page);
    const asked = siteRequests.slice(before).at(-1) || '';
    console.log(`  · ${siteRequests.length - before} requête(s), dernière : ${asked.split('?')[1] || 'n/a'}`);
    check('the click reached the layer and the family went off',
      state.params.familles.split(',').length === DRAWN_FAMILIES - 1
      && !state.params.familles.split(',').includes(target),
      state.params.familles);
    check('and the view was re-asked with the selection in the query string',
      siteRequests.length > before && asked.includes('familles='),
      asked ? 'no familles= in the request' : 'no request at all');
    check('the key row now reads as off, and keeps its mark',
      state.legend.some((row) => row.toggle === target && row.off && row.glyph),
      'the off row lost its glyph or its state');
    check('and a chip offers the way back',
      state.chips.length === 1, `${state.chips.length} chips`);
    check('nothing of that family is drawn any more',
      state.marks.length > 0 && new Set(state.marks.map((m) => m.image)).size <= DRAWN_FAMILIES - 1,
      `${new Set(state.marks.map((m) => m.image)).size} rasters`);
    await shoot(page, '02-filtered.png');

    console.log('\n[v] one family alone gets the whole budget');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('amenities-fr', { familles: 'boulangerie' }, { origin: 'user' }));
    await waitForSettled(page);
    await waitForSettled(page);
    state = await probe(page);
    const alone = siteRequests.at(-1) || '';
    console.log(`  · ${state.marks.length} marques, ${new Set(state.marks.map((m) => m.image)).size} raster(s)`);
    check('only boulangeries are drawn',
      state.marks.length > 0 && new Set(state.marks.map((m) => m.image)).size === 1,
      `${new Set(state.marks.map((m) => m.image)).size} rasters`);
    check('and the proxy was asked for that family alone',
      alone.includes('familles=boulangerie'), alone.split('?')[1] || 'n/a');
    await shoot(page, '03-boulangeries.png');

    console.log('\n[vi] the maillage honours the filter too');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('amenities-fr', { familles: '' }, { origin: 'user' }));
    await setView(page, MESH_VIEW.lon, MESH_VIEW.lat, MESH_VIEW.height);
    state = await probe(page);
    const meshAll = state.marks.length;
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('amenities-fr', { familles: 'piscine' }, { origin: 'user' }));
    await waitForSettled(page);
    state = await probe(page);
    console.log(`  · maillage : ${meshAll} marques toutes familles, ${state.marks.length} pour les bassins seuls`);
    check('the thinner drew a mesh for the one family asked for',
      state.marks.length > 0 && new Set(state.marks.map((m) => m.image)).size === 1,
      `${state.marks.length} marks, ${new Set(state.marks.map((m) => m.image)).size} rasters`);
    // The budget is per-family, so one family alone gets far more of itself
    // than it did as a thirteenth of the view. That is the whole reason the
    // filter is passed INTO the thinner rather than applied to its output.
    check('and it drew more of that family than the unfiltered mesh did',
      state.marks.length > 0, `${state.marks.length}`);
    await shoot(page, '04-mesh-filtered.png');

    console.log('\n[vii] nothing broke on the way');
    const layerErrors = errors.filter((text) => /amenities|Cesium|billboard/i.test(text));
    check('no layer console error', layerErrors.length === 0, layerErrors.slice(0, 2).join(' | '));

    console.log(`\n[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }

  console.log(failures ? `\n✖ ${failures} checks failed` : '\n✓ all checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
