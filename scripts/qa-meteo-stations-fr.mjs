#!/usr/bin/env node
/**
 * Deterministic browser proof for the Stations météo layer (`meteo-stations-fr`).
 *
 * The network is a SHIPPED file, so unlike the live layers there is nothing to
 * intercept — this harness reads the same `stations.json` the browser does and
 * proves the five things only a real Cesium scene can prove:
 *
 *   i.   THE GATE: the 190 stations that publish reach the globe and the 1 954
 *        that do not are absent from the scene, while the layer keeps reporting
 *        the network's own totals and what it withheld
 *   ii.  colour is the measured class: the palette on screen matches what each
 *        station's inventory says it can measure, including the eight drawn
 *        stations that are not complete synoptic ones
 *   iii. every drawn marker wears the ring that promises a public reading, and
 *        the ring count is the archive's 190 and not the list's 62
 *   iv.  clicking a station opens a card, and the observation the proxy serves
 *        comes from the archive prefix that is still being written
 *   v.   markers stand ON the terrain — an unclamped point at MONT AIGOUAL's
 *        1 567 m slides across the map as the camera pans
 *
 * Screenshots are written under the gitignored `qa-shots/meteo-stations/`.
 *
 * Run: node scripts/qa-meteo-stations-fr.mjs --url http://localhost:4173
 *
 * The live-observation half needs the DEV SERVER: `/api/meteo-stations/*` is a
 * Vite middleware, and `vite preview` answers those paths with the SPA's HTML.
 * The harness probes for it and reports "not testable here" rather than
 * "broken" when run against a preview build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'meteo-stations');
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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const REGISTRY = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'local_data', 'meteo_stations_fr', 'stations.json'), 'utf8',
));
const byName = (name) => REGISTRY.stations.find((station) => station.name === name);

const LAYER_ID = 'meteo-stations-fr';
/** A station that publishes hourly and is absent from the published SYNOP list. */
const BOULOGNE_OMM = '07002';
const PREFIX = 'meteo-station:';

/** The palette, restated rather than imported: a QA harness asserts, it doesn't style. */
const SYNOPTIC = '#7ee8fa';
const TEMP_RAIN = '#ffd166';
const LIVE_RING = '#e8f6ff';

/**
 * A view holding all of metropolitan France, and one holding the Mont Aigoual.
 *
 * The clamp used to be proved on the AIGUILLE DU MIDI at 3 845 m, the highest
 * instrument in France — which does not publish, so the gate no longer draws
 * it. MONT AIGOUAL at 1 567 m is the highest station that does, and 1 567 m of
 * unclamped drift is still 1 567 m of drift.
 */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_200_000 };
const AIGOUAL = { lon: 3.5817, lat: 44.1214, height: 40_000 };

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
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
  await pump(page, 4);
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
 * Read the layer's rendered state out of the live scene.
 *
 * Reads the POINT PRIMITIVES, not the layer's model: the point of a browser
 * proof is that the paint reached the globe, so sizes, colours, outlines and
 * alphas come off the collection and positions are unprojected back to degrees.
 */
function sceneProbe(page) {
  return page.evaluate((layerId, prefix) => {
    const gev = window.__godsEyeView;
    // `dataManager` exists before every layer has registered into it, so the
    // boot poll can win the race and this can still be undefined. Reporting
    // "not registered yet" lets the caller keep polling; reading `.module` off
    // undefined turned a slow boot into a crash that looked like a bug.
    const entry = gev.dataManager.layers.get(layerId);
    if (!entry?.module) return { registered: false, points: [], collectionFound: false };
    const { module } = entry;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith(prefix)) collection = primitive;
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    for (let i = 0; collection && i < collection.length; i += 1) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      points.push({
        id: String(point.id),
        pixelSize: point.pixelSize,
        color: hex(point.color),
        alpha: point.color?.alpha ?? null,
        outline: hex(point.outlineColor),
        outlineWidth: point.outlineWidth,
        lat: carto ? carto.latitude * r2d : null,
        lon: carto ? carto.longitude * r2d : null,
        // The rendered ELLIPSOIDAL height. A marker left at 0 under the
        // Aiguille du Midi is nearly four kilometres underground, and drifts
        // on screen as the camera pans.
        height: carto ? carto.height : null,
      });
    }
    return {
      registered: true,
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(40),
      overlay: window.__gevWorldOverlay?.getDiagnostics?.() || null,
      points,
      collectionFound: Boolean(collection),
      shown: collection ? collection.show !== false : null,
    };
  }, LAYER_ID, PREFIX);
}

/** Screen position of a rendered marker, by its render id. */
async function markerAt(page, renderId) {
  return page.evaluate((id, prefix) => {
    const scene = window.__godsEyeView.viewer.scene;
    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith(prefix)) collection = primitive;
    }
    if (!collection) return null;
    for (let i = 0; i < collection.length; i += 1) {
      const point = collection.get(i);
      if (String(point.id) !== id) continue;
      const window2d = scene.cartesianToCanvasCoordinates(point.position);
      if (!window2d) return null;
      return { x: Math.round(window2d.x), y: Math.round(window2d.y) };
    }
    return null;
  }, renderId, PREFIX);
}

/**
 * Click the canvas with synthetic pointer events.
 *
 * `page.mouse.click` needs a layout round trip that starves under SwiftShader,
 * and Cesium's `ScreenSpaceEventHandler` listens for pointer events on the
 * canvas rather than for a synthesised `click`.
 */
async function pointerClick(page, x, y) {
  await page.evaluate((cx, cy) => {
    const canvas = window.__godsEyeView?.viewer?.scene?.canvas;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const common = {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1,
      clientX: box.left + cx, clientY: box.top + cy,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', common));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
  }, x, y);
}

/**
 * Wait for a source to paint, rather than reading once and hoping.
 *
 * The card is painted synchronously on selection, but the overlay SOLVER runs
 * on its own pass, so a single read right after the click races it. Measured
 * on 2026-09-14: the same click reported 0 painted entries on one run and 1 on
 * the next, the only difference being one extra probe's worth of delay.
 * @returns {Promise<number>} Entries painted by that source, 0 if it never did.
 */
async function waitForPaint(page, source, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const painted = await paintedBySource(page);
    if ((painted[source] || 0) > 0) return painted[source];
    await pump(page, 3, 120);
  }
  return 0;
}

/**
 * How many entries each overlay source actually PAINTED.
 *
 * The cards are drawn to a canvas, not to the DOM, so a browser proof can
 * assert that the selected-card source painted — never what it says. The
 * card's text is pinned in `meteoStationsFrance.test.mjs`, against the same
 * shipped file.
 */
function paintedBySource(page) {
  return page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {});
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Polled with `page.evaluate`, not `page.waitForFunction`: under
    // SwiftShader the default rAF polling never ticks.
    let booted = false;
    for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
      booted = await page.evaluate(
        () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
      ).catch(() => false);
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('the app never created window.__godsEyeView');
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    console.log('[qa] i. the whole network reaches the globe');
    // Registration can still be in flight when the boot poll returns, so the
    // enable is retried until the layer is there to be enabled.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const registered = await page.evaluate((layerId) => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager?.layers?.get(layerId)?.module) return false;
        manager.setEnabled(layerId, true);
        return true;
      }, LAYER_ID);
      if (registered) break;
      await sleep(500);
    }
    let probe = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.registered && probe.collectionFound
        && probe.points.length >= REGISTRY.stats.live) break;
    }
    if (!probe?.registered) throw new Error(`${LAYER_ID} never registered into the data manager`);
    check('the point collection reached the scene', probe.collectionFound);
    check(`exactly ${REGISTRY.stats.live} markers are drawn — the stations that publish`,
      probe.points.length === REGISTRY.stats.live, `${probe.points.length} drawn`);
    // The gate, read off the SCENE and not off the model: no marker on the
    // globe may belong to a station whose readings are behind the key.
    const silentIds = new Set(REGISTRY.stations.filter((s) => !s.live).map((s) => s.id));
    const leaked = probe.points.filter((point) => silentIds.has(point.id.slice(PREFIX.length)));
    check('no station that publishes nothing reaches the globe',
      leaked.length === 0, `${leaked.length} leaked`);
    check('the network\'s own totals are reported, whatever the gate hides',
      probe.stats.stations === REGISTRY.stats.stations
      && probe.stats.metropole + probe.stats.overseas === probe.stats.stations,
      `${probe.stats.stations} stations`);
    check('and what was withheld is named rather than silently dropped',
      probe.stats.withheld === REGISTRY.stats.stations - REGISTRY.stats.live
      && /clé/.test(probe.stats.withheldReason || ''),
      `${probe.stats.withheld} withheld`);
    check('what publishes and what is merely listed stay separable',
      probe.stats.live === REGISTRY.stats.live
      && probe.stats.listedSynop === REGISTRY.stats.synop
      && probe.stats.live > probe.stats.listedSynop * 2,
      `${probe.stats.live} publish, ${probe.stats.listedSynop} listed`);
    await shoot(page, '01-france.png');

    console.log('[qa] ii. colour is the measured class');
    const published = REGISTRY.stations.filter((s) => s.live);
    const drawn = new Map(probe.points.map((point) => [point.id.slice(PREFIX.length), point]));
    const toulouse = drawn.get(byName('TOULOUSE-BLAGNAC').id);
    check('a complete synoptic station is drawn in the synoptic colour',
      toulouse?.color === SYNOPTIC, toulouse?.color);
    // The gate removes the grey and the hollow from the map — both belong to
    // stations that publish nothing — so what has to be proved here is the
    // opposite: the eight drawn stations that are NOT complete keep their own
    // colours instead of being flattened into the majority.
    const exceptions = published.filter((s) => s.klass !== 'synoptic');
    const exceptionsPainted = exceptions.filter(
      (s) => drawn.get(s.id) && drawn.get(s.id).color !== SYNOPTIC,
    );
    check('the stations that are not complete keep their own colour',
      exceptions.length > 0 && exceptionsPainted.length === exceptions.length,
      `${exceptionsPainted.length} of ${exceptions.length}`);
    const capBear = drawn.get(byName('CAP BEAR').id);
    check('CAP BEAR publishes and measures neither wind nor pressure — drawn as such',
      capBear?.color === TEMP_RAIN, capBear?.color);
    // Size must track the instrument count, not the altitude or the pack.
    const richest = published.reduce(
      (best, s) => ((s.fam?.length || 0) > (best.fam?.length || 0) ? s : best), published[0],
    );
    const poorest = published.reduce(
      (worst, s) => ((s.fam?.length || 0) < (worst.fam?.length || 0) ? s : worst), published[0],
    );
    check('the best-instrumented station is drawn larger than the poorest one',
      drawn.get(richest.id)?.pixelSize > drawn.get(poorest.id)?.pixelSize,
      `${drawn.get(richest.id)?.pixelSize}px vs ${drawn.get(poorest.id)?.pixelSize}px`);

    console.log('[qa] iii. every drawn marker wears the ring that promises a reading');
    const boulogne = drawn.get(byName('BOULOGNE-SEM').id);
    check('BOULOGNE-SEM publishes and is ringed, though the SYNOP list omits it',
      boulogne?.outline === LIVE_RING, boulogne?.outline);
    check('CAP CEPET is on that list, has written nothing all year, and is not on the globe',
      !drawn.has(byName('CAP CEPET').id));
    const ringed = probe.points.filter((point) => point.outline === LIVE_RING);
    check('the rings count the archive, not the list, and now they are the whole map',
      ringed.length === REGISTRY.stats.live && ringed.length === probe.points.length,
      `${ringed.length} rings for ${probe.points.length} markers`);
    // The two stations the layer used to be loudest about. Neither publishes,
    // so neither is drawn — the hollow disc and the neutral grey are dormant,
    // and this asserts the gate rather than the absence of the rule.
    check('MARSILLARGUES, closed and still listed by Météo-France, is not drawn',
      !drawn.has(byName('MARSILLARGUES').id));
    check('ALBA LA ROMAINE, in no metadata file at all, is not drawn',
      !drawn.has(byName('ALBA LA ROMAINE').id));

    console.log('[qa] iii-bis. the row offers no chips it cannot honour');
    const controls = await page.evaluate((layerId) => {
      const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
      const value = module?.getRowControls?.() || null;
      return {
        chips: (value?.chips || []).length,
        legend: (value?.legend || []).map((entry) => entry.label),
        hasSetParams: typeof module?.setParams === 'function',
      };
    }, LAYER_ID);
    check('no filter chips — the three it used to carry kept 187 to 190 of 190',
      controls.chips === 0, `${controls.chips} chips`);
    check('and no runtime params behind them', controls.hasSetParams === false);
    check('the legend still names the classes on screen',
      controls.legend.includes('Synoptique complète'), controls.legend.join(', '));
    check('and it no longer claims a ring that every marker wears',
      !controls.legend.includes('Anneau = relevés publics'));

    console.log('[qa] iv. clicking a station opens a card');
    const observationsLive = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/meteo-stations/status');
        const body = await response.json();
        return typeof body?.ttlMs === 'number';
      } catch { return false; }
    });
    if (!observationsLive) {
      console.log('  · /api/meteo-stations is a dev-server middleware — live readings not testable here');
    }

    // A station that does NOT publish has no marker to click. Proved by flying
    // to one and finding nothing: that is the whole change, and a reader who
    // never learns such a station exists is the intended outcome.
    const silent = REGISTRY.stations.find(
      (s) => !s.live && Array.isArray(s.fam) && s.fam.length >= 2 && s.dep === '01',
    ) || REGISTRY.stations.find((s) => !s.live && Array.isArray(s.fam));
    await setView(page, silent.lon, silent.lat, 30_000);
    await pump(page, 6);
    let at = await markerAt(page, `${PREFIX}${silent.id}`);
    check(`${silent.name} measures and publishes nothing, so there is nothing to click`,
      at === null || at === undefined, JSON.stringify(at));
    await shoot(page, '04-station-muette-absente.png');

    if (observationsLive) {
      // The headline feature: a station that publishes gets its last hour's
      // reading. Asserted against the PROXY's own answer rather than against a
      // literal temperature, because the weather moves and a harness that
      // pinned 17,4 °C would fail every hour by design.
      const reading = await page.evaluate(async (omm) => {
        const response = await fetch('/api/meteo-stations/observations');
        const body = await response.json();
        return { stations: body?.stations ?? 0, newest: body?.newest ?? null, mine: body?.observations?.[omm] ?? null };
      }, BOULOGNE_OMM);
      check('the observations proxy serves the archive, not the 62-station list',
        reading.stations === REGISTRY.stats.live, `${reading.stations} stations`);
      check('and it carries a reading for a station the SYNOP list omits',
        Boolean(reading.mine?.at), JSON.stringify(reading.mine)?.slice(0, 80));
      // The reading must come from the prefix that is still being written. The
      // frozen `synchro_ftp` copy answers 200 forever and its newest row ages
      // by a day every day, so a fixed threshold is what catches it: 3 days is
      // wider than the product's own 11-to-35-hour lag and far narrower than a
      // mirror that has stopped. See trap 6 in `meteoStationsFrFeed.js`.
      const lagHours = reading.newest
        ? (Date.now() - Date.parse(reading.newest)) / 3_600_000 : Infinity;
      check('the newest observation is days old, not weeks — the live archive prefix',
        Number.isFinite(lagHours) && lagHours < 72,
        `${Number.isFinite(lagHours) ? lagHours.toFixed(0) : '∞'} h old (${reading.newest})`);

      const live = byName('BOULOGNE-SEM');
      await setView(page, live.lon, live.lat, 30_000);
      await pump(page, 6);
      at = await markerAt(page, `${PREFIX}${live.id}`);
      if (check(`${live.name} is on screen to be clicked`, Boolean(at))) {
        await pointerClick(page, at.x, at.y);
        // Two paints: the local one, then the one the network completes.
        await pump(page, 10, 150);
        await sleep(1500);
        await pump(page, 6);
        const painted = await waitForPaint(page, 'meteo-stations-fr-selected');
        check('a station that publishes opens a card too', painted > 0);
        await shoot(page, '06-carte-station-live.png');
      }
    }

    console.log('[qa] v. markers stand on the terrain, not under it');
    // Two different reasons the clamp can be untestable, and they are NOT the
    // same as it being broken:
    //   · `/api/terrain/heights` is a DEV SERVER middleware, so a run against
    //     `vite preview` gets the SPA's HTML back;
    //   · the Re:Earth DEM behind that middleware answers 500 under load, and
    //     an unresolved cell simply does not clamp — by design, everywhere in
    //     this app.
    // Both are reported as "not testable here". A harness that failed on an
    // upstream outage would teach whoever reads it to ignore this check.
    const terrainProbe = async () => page.evaluate(async () => {
      try {
        // Points inside the Aigoual massif that no earlier probe warmed, so a
        // cached hit cannot make a failing upstream look healthy.
        const response = await fetch(
          '/api/terrain/heights?points=3.5431,44.1002;3.6122,44.1411;3.5019,44.1553',
        );
        const body = await response.json();
        return Array.isArray(body?.results)
          && body.results.length === 3
          && body.results.every((point) => Number.isFinite(point?.ellipsoid));
      } catch { return false; }
    });

    if (!(await terrainProbe())) {
      console.log('  · /api/terrain/heights unavailable — clamp not testable in this run');
    } else {
      await setView(page, AIGOUAL.lon, AIGOUAL.lat, AIGOUAL.height);
      const aigoualId = `${PREFIX}${byName('MONT AIGOUAL').id}`;
      let clamped = null;
      for (let attempt = 0; attempt < 25 && !clamped; attempt += 1) {
        await pump(page, 4, 100);
        await sleep(400);
        const near = await sceneProbe(page);
        const aigoual = near.points.find((point) => point.id === aigoualId);
        if (aigoual && aigoual.height > 500) clamped = aigoual;
      }
      if (!clamped && !(await terrainProbe())) {
        // It resolved nothing AND the DEM has since started failing: that is
        // the outage, not the layer.
        console.log('  · the terrain DEM began failing mid-run — clamp not testable');
      } else {
        // The published altitude is 1 567 m; the clamp puts the marker on the
        // terrain under it, which the DEM will not place at exactly that
        // height. A marker left on the ellipsoid sits near 0.
        check('the Mont Aigoual marker is lifted onto the terrain, not left on the ellipsoid',
          clamped && clamped.height > 1000,
          clamped ? `${clamped.height.toFixed(0)} m` : 'never clamped');
      }
      await shoot(page, '05-mont-aigoual.png');
    }

    const fatal = consoleErrors.filter(
      (text) => !/favicon|ResizeObserver|WebGL|SwiftShader|Failed to load resource/i.test(text),
    );
    check('no unexpected console errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`✖ ${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`   · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('✓ Stations météo (FR) — every check passed');
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error?.stack || error}`);
  process.exitCode = 1;
});
