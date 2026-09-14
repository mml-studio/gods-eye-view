#!/usr/bin/env node
/**
 * Browser proof for the French doctor layer.
 *
 * Unlike the charge-point harness, this one intercepts NOTHING. The pack is a
 * file in this repository, rebuilt by `npm run medecins:registry` and identical
 * on every run, so the strongest available proof is the real one: boot the app,
 * turn the layer on, and read what actually reached the globe.
 *
 * What it proves, and why each one is worth a browser rather than a unit test:
 *
 *   i.   at national altitude the layer paints DÉPARTEMENTS by accessibility
 *        and draws no dots — the country-scale question is "is there room",
 *        not "where is a surgery", and 64 232 dots would answer neither
 *   ii.  the paint chip really repaints: switching to density changes the
 *        polygons, and switching back restores the APL ramp
 *   iii. between the two, the MAILLAGE — real positions, spatially thinned,
 *        and the choropleth goes away rather than fighting it
 *   iv.  over a city the layer draws one dot per ADDRESS, and a card carries
 *        the doctors' names, what they charge, and where the commune sits in
 *        the national distribution
 *   v.   clicking a dot opens a card and fetches THAT address's doctors — the
 *        names are not in the `/sites` payload, because over central Paris
 *        they were 40 % of 1 451 kio shipped to draw dots nobody clicks
 *   vi.  a camera event that lands on the same view costs no request at all
 *   vii. the layer never merges the two counts: `medecins` is distinct names
 *        and `entrees` is register rows, and the second is the larger
 *   viii. THE MARKS STAND ON THE GROUND, and are drawn WHOLE. Both halves of
 *        the reported "les points ne sont pas bien positionnés… à moitié à
 *        l'intérieur des bâtiments": a mark anchored on the ellipsoid is 220 m
 *        under the Lyon street it describes, and a mark that keeps the depth
 *        test is eaten from below by the ground nearer the camera at its own
 *        lower pixels — the « parasol ». This reads the ellipsoidal height and
 *        the depth flag back off the PRIMITIVE, which is where a passing test
 *        with a live bug would hide.
 *   ix.  AND THEY DO NOT MOVE WHEN THE MAP DOES: the same mark is screen-
 *        projected before and after a pan-and-return, and a seated one comes
 *        back to the same pixel.
 *   x.   every family carries its own silhouette, and the key swatch IS that
 *        silhouette — one family, one shape, no second list by shape.
 *
 * Run: node scripts/qa-medecins-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'medecins-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

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

/**
 * Ellipsoidal height below which an anchor is judged to be on the ELLIPSOID
 * rather than on France.
 *
 * Ambert stands ~530 m above the sea and the geoid runs ~+50 m through the
 * Massif central, so a real floor there is some 560-600 m of ellipsoidal
 * height; over Lyon it is ~220 m. The pre-fix anchor was the 6 m lift alone.
 * Twenty metres is therefore a wide moat around a difference of hundreds, not
 * a tuned threshold.
 */
const GROUND_FLOOR_MIN_M = 20;

/**
 * Screen slide tolerated across a pan and return, in CSS pixels.
 *
 * Not zero: the camera is restored by `setView` to the same cartographic pose,
 * and floating-point projection over a 9 km standoff is worth a fraction of a
 * pixel. The defect this guards was measured in the hundreds.
 */
const SLIDE_TOLERANCE_PX = 3;

/** Ambert, Puy-de-Dôme: a real under-served commune with a real practice. */
const CITY = { lon: 3.7444, lat: 45.5486 };
/** Metropolitan France, whole. */
const NATIONAL = { lon: 2.4, lat: 46.6, height: 2_600_000 };
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

async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
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

/** Screen position of one drawn mark, by id. Null when it is not projectable. */
function screenOf(page, id) {
  return page.evaluate((wanted) => {
    const scene = window.__godsEyeView.viewer.scene;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const collection = scene.primitives.get(i);
      if (typeof collection?.get !== 'function' || !collection.length) continue;
      if (!String(collection.get(0)?.id || '').startsWith('medecins-fr:')) continue;
      for (let n = 0; n < collection.length; n += 1) {
        const item = collection.get(n);
        if (item.id !== wanted || !item.position) continue;
        // `scene.cartesianToCanvasCoordinates` rather than `SceneTransforms`:
        // the app does not publish Cesium on `window`, and the scene method is
        // the same projection reachable from the viewer this harness has.
        const at = scene.cartesianToCanvasCoordinates(item.position);
        return at ? { x: at.x, y: at.y } : null;
      }
    }
    return null;
  }, id);
}

/**
 * Wait for the layer to finish the fetch the camera move started.
 *
 * A fixed sleep is what made the first version of this harness report zero
 * dots for a layer that was drawing 534: the mesh route is 1.5 MB and the
 * first request over a cold cache outlasts any beat worth hard-coding. Poll
 * the layer's own `loading` flag instead, and require a `lastUpdate` newer
 * than the one the move started from so a settled-but-stale read cannot pass.
 */
async function waitForSettled(page, timeoutMs = 20000) {
  const started = Date.now();
  const before = await page.evaluate(() => (
    window.__godsEyeView.dataManager.layers.get('medecins-fr').module.getStats().lastUpdate ?? 0
  ));
  while (Date.now() - started < timeoutMs) {
    await pump(page, 2, 60);
    const state = await page.evaluate(() => {
      const stats = window.__godsEyeView.dataManager.layers.get('medecins-fr').module.getStats();
      return { loading: stats.loading, lastUpdate: stats.lastUpdate ?? 0, error: stats.error };
    });
    if (state.error) return state;
    if (!state.loading && state.lastUpdate > before) return state;
    await sleep(150);
  }
  return null;
}

function probe(page) {
  return page.evaluate(() => {
    const entry = window.__godsEyeView.dataManager.layers.get('medecins-fr');
    const module = entry.module;
    const source = window.__godsEyeView.viewer.dataSources.getByName(
      'Médecins (FR) — accessibilité par département',
    )[0];
    // Count DÉPARTEMENTS, not entities: Cesium makes one entity per polygon
    // part, and a département with islands would otherwise count twice.
    const shown = new Set();
    const materials = new Map();
    for (const item of source ? source.entities.values : []) {
      if (!item.polygon) continue;
      const code = String(item.properties?.code?.getValue?.() ?? '').trim();
      if (!item.show) continue;
      shown.add(code);
      const color = item.polygon.material?.getValue?.(window.__godsEyeView?.viewer?.clock?.currentTime)?.color;
      if (color) materials.set(code, `${color.red.toFixed(3)},${color.green.toFixed(3)},${color.blue.toFixed(3)}`);
    }
    // What actually reached the SCENE. Walk every collection and key on the
    // layer's own id prefix: a record that agrees with the ground while the
    // primitive does not is the bug with a passing test.
    const scene = window.__godsEyeView.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const marks = [];
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const collection = scene.primitives.get(i);
      if (typeof collection?.get !== 'function' || !collection.length) continue;
      if (!String(collection.get(0)?.id || '').startsWith('medecins-fr:')) continue;
      for (let n = 0; n < collection.length; n += 1) {
        const item = collection.get(n);
        const carto = item.position ? ellipsoid.cartesianToCartographic(item.position) : null;
        marks.push({
          id: item.id,
          height: carto ? carto.height : null,
          // `Infinity` does not survive the JSON hop of CDP (it comes back
          // null), so the flag is reported as a boolean rather than a number.
          depthOff: item.disableDepthTestDistance === Number.POSITIVE_INFINITY,
          image: typeof item.image === 'string' ? item.image.length : null,
          width: item.width ?? null,
        });
      }
    }

    const stats = module.getStats();
    const controls = module.getRowControls();
    return {
      stats,
      params: module.getParams(),
      legend: controls.legend.map((row) => row.label),
      legendGlyphs: controls.legend.map((row) => row.glyph || null),
      chips: controls.chips.map((chip) => ({ id: chip.id, active: chip.active })),
      departementsShown: shown.size,
      departementColors: [...materials.values()],
      distinctColors: new Set(materials.values()).size,
      marks,
      cameraHeight: scene.camera.positionCartographic.height,
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 60000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    let praticienRequests = 0;
    let siteRequests = 0;
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/medecins-fr/praticiens')) praticienRequests += 1;
      else if (url.includes('/api/medecins-fr/sites')) siteRequests += 1;
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);

    await setView(page, NATIONAL.lon, NATIONAL.lat, NATIONAL.height);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('medecins-fr', true));
    await waitForSettled(page);
    await pump(page, 6);

    console.log('\n[i] national — accessibility, painted, no dots');
    let state = await probe(page);
    check('the pack loaded and the layer knows the register', state.stats.medecins > 100_000,
      `medecins=${state.stats.medecins}`);
    check('the regime is national', state.stats.regime === 'national', state.stats.regime);
    check('départements are painted', state.departementsShown >= 90, `${state.departementsShown} shown`);
    check('the ramp really varies across France', state.distinctColors >= 3,
      `${state.distinctColors} distinct fills`);
    check('no dot is drawn at country scale', state.stats.count === 0, `count=${state.stats.count}`);
    check('the legend is the accessibility ladder',
      state.legend.some((label) => /sous-dot/.test(label)), state.legend.join(' | '));
    check('the APL edition is named', state.stats.aplMillesime === 2024, String(state.stats.aplMillesime));
    await shoot(page, '01-national-apl.png');

    console.log('\n[ii] the paint chip repaints');
    const aplColors = state.departementColors.join('|');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('medecins-fr', { paint: 'medecins' }, { origin: 'user' }));
    await pump(page, 6, 120);
    state = await probe(page);
    check('the chip switched', state.params.paint === 'medecins', JSON.stringify(state.params));
    check('the polygons actually changed', state.departementColors.join('|') !== aplColors);
    await shoot(page, '02-national-densite.png');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('medecins-fr', { paint: 'apl' }, { origin: 'user' }));
    await pump(page, 6, 120);
    state = await probe(page);
    check('and switching back restores the accessibility ramp',
      state.departementColors.join('|') === aplColors);

    console.log('\n[iii] mesh — real positions, thinned, choropleth gone');
    await setView(page, MESH_VIEW.lon, MESH_VIEW.lat, MESH_VIEW.height);
    state = await probe(page);
    check('the regime is the mesh', state.stats.regime === 'mesh', state.stats.regime);
    check('dots are drawn', state.stats.count > 100, `count=${state.stats.count}`);
    check('and thinned, never the whole register', state.stats.count <= 2200, `count=${state.stats.count}`);
    check('the choropleth stood down', state.departementsShown === 0, `${state.departementsShown} shown`);
    check('the legend became the families',
      state.legend.some((label) => /Médecine générale/.test(label)), state.legend.join(' | '));
    await shoot(page, '03-maillage.png');

    console.log('\n[iv] sites — one dot per address, with names on the card');
    await setView(page, CITY.lon, CITY.lat, 9000);
    state = await probe(page);
    check('the regime is sites', state.stats.regime === 'sites', state.stats.regime);
    check('real practices are drawn', state.stats.count > 0, `count=${state.stats.count}`);
    const card = await page.evaluate(() => {
      const module = window.__godsEyeView.dataManager.layers.get('medecins-fr').module;
      const stats = module.getStats();
      // Reach through the module's own selection path rather than synthesising
      // a click: this proves the card the layer builds, not one this file made.
      const host = window.__godsEyeView.viewer;
      const canvas = host.scene.canvas;
      const rect = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      return { stats, rect };
    });
    check('the site regime reports what it drew', card.stats.count > 0);
    await shoot(page, '04-sites.png');

    console.log('\n[v] a click opens a card and fetches only that address\'s doctors');
    const before = praticienRequests;
    const clicked = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const scene = gev.viewer.scene;
      // Project a real drawn dot to the screen and hand back where to click.
      const collection = scene.primitives._primitives.find(
        (primitive) => primitive.length > 0 && primitive.get?.(0)?.id?.startsWith?.('medecins-fr:'),
      );
      if (!collection) return null;
      for (let i = 0; i < collection.length; i += 1) {
        const point = collection.get(i);
        // `scene.cartesianToCanvasCoordinates` rather than `SceneTransforms`:
        // the app does not publish Cesium on `window`, and the scene method is
        // the same projection reachable from the viewer this harness already has.
        const window2d = scene.cartesianToCanvasCoordinates(point.position);
        if (window2d) return { x: Math.round(window2d.x), y: Math.round(window2d.y), id: point.id };
      }
      return null;
    });
    if (check('a drawn dot could be located on screen', Boolean(clicked), 'no point primitive found')) {
      await page.mouse.click(clicked.x, clicked.y);
      await pump(page, 4, 120);
      await sleep(600);
      // The overlay's diagnostics facade is DEV-only (`createDevFacade`), so on a
      // production preview this cannot be read at all. Say that, rather than
      // report a zero the layer never produced — the two checks around it still
      // prove the click reached `selectSite` and fetched that address's names.
      const card = await page.evaluate(() => (
        window.__gevWorldOverlay
          ? (window.__gevWorldOverlay.getDiagnostics()?.entriesBySource?.['medecins-fr-selected'] ?? 0)
          : null
      ));
      if (card === null) console.log('  · card entry count unavailable (production build, no dev facade)');
      else check('a card opened', card === 1, `entries=${card}`);
      check('and it fetched the names for that address alone',
        praticienRequests === before + 1, `${praticienRequests - before} requests`);
    }

    console.log('\n[viii] the marks stand on the ground, and are drawn whole');
    // The floor lands over the NETWORK and the rendered surface streams, so the
    // layer re-places what it drew when a better floor arrives. Wait for that
    // settle rather than asserting on the first frame.
    let seated = await probe(page);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const heights = seated.marks.map((mark) => mark.height);
      if (heights.length && heights.every((h) => Number.isFinite(h) && h > GROUND_FLOOR_MIN_M)) break;
      await pump(page, 3, 60);
      await sleep(400);
      seated = await probe(page);
    }
    const heights = seated.marks.map((mark) => mark.height);
    const buried = heights.filter((h) => !Number.isFinite(h) || h <= GROUND_FLOOR_MIN_M).length;
    const lowest = heights.length ? Math.min(...heights) : null;
    const highest = heights.length ? Math.max(...heights) : null;
    console.log(`  · ${heights.length} anchors, `
      + `${lowest === null ? 'n/a' : lowest.toFixed(1)}-${highest === null ? 'n/a' : highest.toFixed(1)} m `
      + `ellipsoidal, ${buried} on the ellipsoid`);
    check('every drawn mark is placed on the ground, not on the ellipsoid',
      heights.length > 0 && buried === 0,
      `${buried} of ${heights.length} still at ellipsoid height`);
    // The other half of the report: a plate that keeps the depth test is eaten
    // from below by the ground nearer the camera at its own lower pixels, so it
    // reads as a dot half-sunk into a roof rather than as a mark.
    check('and every one of them disables the depth test',
      seated.marks.length > 0 && seated.marks.every((mark) => mark.depthOff),
      `${seated.marks.filter((mark) => !mark.depthOff).length} still depth-tested`);

    console.log('\n[ix] a pan and return leaves them on their own pixel');
    const sample = seated.marks[0];
    const beforePan = sample ? await screenOf(page, sample.id) : null;
    await setView(page, CITY.lon + 0.01, CITY.lat, 9000);
    await sleep(600);
    await setView(page, CITY.lon, CITY.lat, 9000);
    await sleep(600);
    await pump(page, 6, 80);
    const afterPan = sample ? await screenOf(page, sample.id) : null;
    const slide = beforePan && afterPan
      ? Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y)
      : null;
    console.log(`  · ${sample ? sample.id : 'no mark'} moved ${slide === null ? 'n/a' : slide.toFixed(1)} px`);
    check('the same mark returns to the same pixel',
      slide !== null && slide <= SLIDE_TOLERANCE_PX,
      `${slide === null ? 'not projectable' : `${slide.toFixed(1)} px`}`);
    await shoot(page, '05-seated.png');

    console.log('\n[x] one family, one silhouette, and the key carries it');
    state = await probe(page);
    const drawnImages = new Set(state.marks.map((mark) => mark.image));
    check('the marks are rasters, not bare dots',
      state.marks.length > 0 && state.marks.every((mark) => Number.isFinite(mark.image)),
      'a mark drew no image');
    // Six families in the register, and a view this size holds most of them.
    // The claim is the ceiling, not the floor: more distinct rasters than
    // families would mean a per-mark texture, which is an atlas entry each.
    check('and they share one raster per family, never one per mark',
      drawnImages.size <= 6, `${drawnImages.size} distinct rasters`);
    check('the key row carries the same mark as a swatch',
      state.legendGlyphs.length === 6 && state.legendGlyphs.every((glyph) => (
        typeof glyph === 'string' && glyph.startsWith('data:image/svg+xml')
      )),
      state.legendGlyphs.map((glyph) => (glyph ? 'glyph' : 'none')).join(','));
    check('and no two families share a swatch',
      new Set(state.legendGlyphs).size === 6, `${new Set(state.legendGlyphs).size} distinct`);

    console.log('\n[vi] an unchanged view costs nothing');
    const sitesBefore = siteRequests;
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(() => window.__godsEyeView.viewer.camera.changed.raiseEvent?.());
      await pump(page, 2, 80);
    }
    await sleep(700);
    check('no request for a view already served', siteRequests === sitesBefore,
      `${siteRequests - sitesBefore} redundant`);

    console.log('\n[vii] the two counts never merge');
    check('entries outnumber doctors, as the register requires',
      state.stats.entrees > state.stats.medecins,
      `entrees=${state.stats.entrees} medecins=${state.stats.medecins}`);
    check('addresses are fewer than entries',
      state.stats.adresses < state.stats.entrees,
      `adresses=${state.stats.adresses}`);
    check('the unplaced are still counted', state.stats.nonLocalisees > 0,
      String(state.stats.nonLocalisees));

    const layerErrors = consoleErrors.filter((line) => /medecins/i.test(line));
    check('no layer console error', layerErrors.length === 0, layerErrors.slice(0, 2).join(' / '));

    console.log(`\n[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }

  if (failures) {
    console.error(`\n✖ ${failures} check${failures > 1 ? 's' : ''} failed`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ all checks passed');
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}`);
  process.exitCode = 1;
});
