#!/usr/bin/env node
/**
 * qa-traffic-floor.mjs — headless proof that traffic dots sit on the DRAWN
 * street, not on whatever `sampleHeight` happened to answer while the
 * photorealistic mesh was still streaming.
 *
 * ── The defect this guards ──────────────────────────────────────────────────
 * `parseRoads` used to buy one raw `scene.sampleHeight` per road at parse
 * time and accept any finite answer. Measured on this exact view (Biarritz,
 * camera 900 m, pitch −35°, 2026-09-14): the Google tileset answers
 * **−6 311.7 m** for the first ~10 s of a session and **+54.0 m** once it has
 * drained. The layer parses its roads inside that window on every camera move,
 * so the whole network was baked **6 365 m under the street**. Depth testing is
 * punched through at 2 km, so the dots are painted anyway — they do not read as
 * "buried", they slide across the sky as the camera turns. That is the reported
 * symptom.
 *
 * Controls, in the order they would fail:
 *   (i)   NO BURIED DOT — every rendered dot inside the French road band
 *         (−100 m … 5 000 m ellipsoidal). The pre-fix run puts 100 % of them
 *         at ≈ −6 200 m.
 *   (ii)  ON THE MESH — median |dot − sampleHeight| ≤ 6 m, with the traffic
 *         point collection EXCLUDED from the probes (points are pickable: an
 *         unexcluded probe reads the dot itself and reports a perfect zero).
 *   (iii) ON SCREEN — median pixel distance between a dot and the mesh point
 *         directly under it ≤ 15 px.
 *   (iv)  SURVIVES A MOVE — the same two assertions after a 400 m pan, which
 *         re-fetches and re-parses the network while tiles stream again.
 *
 * `/api/terrain/heights` is answered 503 for the whole run. This layer does not
 * use the DEM proxy today, and the refusal keeps it that way: a harness that
 * lets the network re-seat a layer passes on code that never seats it from the
 * surface it is drawing.
 *
 * Run:  node scripts/qa-traffic-floor.mjs --url http://localhost:4410
 * Exits non-zero on any FAIL. Does not commit anything.
 */

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots');

const argv = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const APP_URL = getOpt('--url', 'http://localhost:4410');
const HEADFUL = argv.includes('--headful');

/** Biarritz: 70 m of relief inside one fetch box, and the view of the report. */
const VIEW = { lat: 43.48875, lon: -1.55462, alt: 900, heading: 20, pitch: -35 };
/** Same box, shifted ~400 m east — enough to force a re-fetch and a re-parse. */
const MOVED = { ...VIEW, lon: VIEW.lon + 0.005 };

/** Ellipsoidal metres a French road can plausibly sit at (geoid included). */
const ROAD_MIN_M = -100;
const ROAD_MAX_M = 5000;
/** Metres — allowed median gap between a dot and the mesh beneath it. */
const MAX_MEDIAN_GAP_M = 6;
/** Pixels — allowed median on-screen gap at the harness canvas. */
const MAX_MEDIAN_PX = 15;

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok === null
    ? '\x1b[33mINCONCLUSIVE\x1b[0m'
    : ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [${tag}] ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashFor(view) {
  return `#lat=${view.lat}&lon=${view.lon}&alt=${view.alt}`
    + `&heading=${view.heading}&pitch=${view.pitch}`;
}

/** Wait for the visible tileset to drain its streaming queue. */
async function waitForMesh(page, timeoutMs = 120000) {
  await page.waitForFunction(() => {
    const scene = window.__godsEyeView?.viewer?.scene;
    if (!scene) return false;
    try { scene.render(); } catch { /* stalled context */ }
    for (let i = 0; i < scene.primitives.length; i++) {
      const p = scene.primitives.get(i);
      if (p?.constructor?.name === 'Cesium3DTileset' && p.show) return !!p.tilesLoaded;
    }
    return false;
  }, { polling: 1000, timeout: timeoutMs });
}

/** Poll the layer until it has dots and has stopped loading. */
async function settleTraffic(page, { minCount = 1, timeoutS = 45 } = {}) {
  let stats = null;
  for (let i = 0; i < timeoutS; i++) {
    await sleep(1000);
    stats = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      try { gev.viewer.scene.render(); } catch { /* stalled context */ }
      return gev.dataManager.layers.get('traffic').module.getStats();
    });
    if (stats.count >= minCount && !stats.loading) break;
  }
  return stats;
}

/**
 * Wait for the seating pass to report every visible road on a reading of its
 * own. This is the layer's OWN signal, not a stopwatch: the convergence time is
 * dominated by probe cost (24 ms each under SwiftShader) and therefore by
 * machine load, so a fixed sleep turns this harness into a load meter.
 * Returns the last seating state either way — failing to converge is a result.
 */
async function waitForSeating(page, timeoutS = 90) {
  let state = null;
  for (let i = 0; i < timeoutS * 2; i++) {
    state = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      try { gev.viewer.scene.render(); } catch { /* stalled context */ }
      const s = gev.dataManager.layers.get('traffic').module.getStats();
      return { armed: s.floorArmed, seated: s.floorSeated, waiting: s.floorWaiting, cells: s.floorCells, boxM: s.floorBoxM };
    });
    if (state.armed && state.waiting === 0 && state.seated > 0) return state;
    await sleep(500);
  }
  return state;
}

/**
 * Read every rendered dot's ellipsoidal height and compare it to the mesh
 * directly beneath it, in metres and in pixels.
 */
async function measureFloor(page, sampleSize) {
  return page.evaluate((maxCount, minM, maxM) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ell = scene.globe.ellipsoid;
    const Cartesian2 = scene.camera.positionWC.constructor === Object ? null : null;
    const mod = gev.dataManager.layers.get('traffic').module;

    // EVERY dot, for the band check — a single buried dot is the defect.
    const collections = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const p = scene.primitives.get(i);
      if (p?.constructor?.name === 'PointPrimitiveCollection') collections.push(p);
    }
    const collSizes = collections.map((c) => c.length);
    const dots = [];
    const excludes = [];
    for (const coll of collections) {
      for (let i = 0; i < coll.length; i++) {
        const pt = coll.get(i);
        excludes.push(pt);
        if (!pt?.show || !pt.position) continue;
        const carto = ell.cartesianToCartographic(pt.position);
        if (carto) dots.push({ pt, carto: { lon: carto.longitude, lat: carto.latitude, h: carto.height } });
      }
    }
    const heights = dots.map((d) => d.carto.h).sort((a, b) => a - b);
    const outOfBand = heights.filter((h) => h < minM || h > maxM).length;

    // Probes are expensive (24 ms each under SwiftShader with 1 700 points in
    // the scene) — sample a stride, never the whole set.
    const stride = Math.max(1, Math.ceil(dots.length / maxCount));
    const gaps = [];
    const pxGaps = [];
    for (let i = 0; i < dots.length; i += stride) {
      const d = dots[i];
      let meshM = null;
      try {
        const h = scene.sampleHeight({ longitude: d.carto.lon, latitude: d.carto.lat, height: 0 }, excludes);
        if (Number.isFinite(h)) meshM = h;
      } catch { /* mid-teardown */ }
      if (meshM === null) continue;
      gaps.push(Math.abs(d.carto.h - meshM));
      // On-screen error: the dot against the mesh point under it.
      const onMesh = ell.cartographicToCartesian({ longitude: d.carto.lon, latitude: d.carto.lat, height: meshM });
      const a = scene.cartesianToCanvasCoordinates(d.pt.position);
      const b = scene.cartesianToCanvasCoordinates(onMesh);
      if (a && b) pxGaps.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
    const med = (arr) => (arr.length ? +arr.slice().sort((x, y) => x - y)[Math.floor(arr.length / 2)].toFixed(1) : null);
    const p90 = (arr) => (arr.length ? +arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * 0.9)].toFixed(1) : null);
    void Cartesian2;
    const s = mod.getStats();
    return {
      count: dots.length,
      collSizes,
      seating: {
        armed: s.floorArmed, seated: s.floorSeated, waiting: s.floorWaiting,
        cells: s.floorCells, boxM: s.floorBoxM,
      },
      stats: { count: s.count, loading: s.loading },
      heightMin: heights.length ? +heights[0].toFixed(1) : null,
      heightMedian: heights.length ? +heights[Math.floor(heights.length / 2)].toFixed(1) : null,
      heightMax: heights.length ? +heights[heights.length - 1].toFixed(1) : null,
      outOfBand,
      probed: gaps.length,
      gapMedianM: med(gaps),
      gapP90M: p90(gaps),
      gapMaxM: gaps.length ? +Math.max(...gaps).toFixed(1) : null,
      pxMedian: med(pxGaps),
      pxP90: p90(pxGaps),
    };
  }, sampleSize, ROAD_MIN_M, ROAD_MAX_M);
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

function assertFloor(label, m) {
  console.log(`  · point collections [${m.collSizes.join(', ')}], layer reports ${m.stats.count} dots`);
  record(
    `${label} — every visible road on a reading of its own`,
    m.seating.armed === true && m.seating.waiting === 0 && m.seating.seated > 0,
    `${m.seating.seated} seated, ${m.seating.waiting} waiting, ${m.seating.cells} cells probed,`
    + ` box floor ${m.seating.boxM} m`,
  );
  record(
    `${label} — no buried dot (band ${ROAD_MIN_M}…${ROAD_MAX_M} m)`,
    m.count > 0 && m.outOfBand === 0,
    `${m.count} dots, ${m.outOfBand} out of band, heights ${m.heightMin}…${m.heightMax} m`,
  );
  record(
    `${label} — dots sit on the mesh (median ≤ ${MAX_MEDIAN_GAP_M} m)`,
    m.probed > 0 && m.gapMedianM !== null && m.gapMedianM <= MAX_MEDIAN_GAP_M,
    `${m.probed} probes, median ${m.gapMedianM} m, p90 ${m.gapP90M} m, max ${m.gapMaxM} m`,
  );
  record(
    `${label} — on-screen error (median ≤ ${MAX_MEDIAN_PX} px)`,
    m.pxMedian !== null && m.pxMedian <= MAX_MEDIAN_PX,
    `median ${m.pxMedian} px, p90 ${m.pxP90} px`,
  );
}

async function main() {
  console.log('\nTraffic Ground-Seating Proof (qa-traffic-floor)');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  View    : Biarritz ${VIEW.lat}, ${VIEW.lon} @ ${VIEW.alt} m, pitch ${VIEW.pitch}°\n`);

  try {
    const res = await fetch(APP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\x1b[31mDev server not reachable at ${APP_URL} (${e.message}).\x1b[0m`);
    process.exit(2);
  }

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    protocolTimeout: 900000,
    ...(findChrome() ? { executablePath: findChrome() } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--disable-dev-shm-usage', '--disable-web-security',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });

  let exitCode = 0;
  try {
    const page = await newQaPage(browser, { photoreal: true });
    await page.setViewport({ width: 1440, height: 900 });

    // Refuse the DEM proxy for the whole run — see the header.
    await page.setRequestInterception(true);
    let demRefused = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/terrain/heights')) {
        demRefused += 1;
        req.respond({ status: 503, contentType: 'application/json', body: '{"error":"refused by qa-traffic-floor"}' });
        return;
      }
      req.continue();
    });
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[Data:Traffic]')) console.log(`  · ${t}`);
    });

    console.log('Loading app...');
    await page.goto(`${APP_URL}/${hashFor(VIEW)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { polling: 200, timeout: 60000 });

    // The user's real flow: the layer comes on while the mesh is still
    // streaming. Enabling AFTER a drain hides the defect entirely.
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('traffic', true));
    const first = await settleTraffic(page);
    console.log(`  · layer settled: ${first.count} dots, mode ${first.mode}`);

    console.log('\nWaiting for the photorealistic mesh to drain...');
    await waitForMesh(page);
    const parkedSeating = await waitForSeating(page);
    console.log(`  · seating: armed=${parkedSeating.armed} seated=${parkedSeating.seated}`
      + ` waiting=${parkedSeating.waiting} cells=${parkedSeating.cells} boxM=${parkedSeating.boxM}`);

    console.log('\n(i)–(iii) Layer enabled mid-stream, measured after drain');
    const parked = await measureFloor(page, 40);
    assertFloor('parked', parked);
    await shoot(page, 'traffic-floor-parked.png');

    console.log('\n(iv) After a 400 m pan (re-fetch + re-parse while tiles stream)');
    await page.evaluate((v) => {
      const gev = window.__godsEyeView;
      const ell = gev.viewer.scene.globe.ellipsoid;
      const d2r = Math.PI / 180;
      try { gev.viewer.camera.cancelFlight(); } catch { /* none active */ }
      gev.viewer.camera.setView({
        destination: ell.cartographicToCartesian({ longitude: v.lon * d2r, latitude: v.lat * d2r, height: v.alt }),
        orientation: { heading: v.heading * d2r, pitch: v.pitch * d2r, roll: 0 },
      });
      // `setView` does not raise `moveEnd`, so nudge the layer's own entry
      // point the way a real drag would.
      gev.viewer.camera.changed.raiseEvent(1);
    }, MOVED);
    await settleTraffic(page);
    await waitForMesh(page);
    const movedSeating = await waitForSeating(page);
    console.log(`  · seating: armed=${movedSeating.armed} seated=${movedSeating.seated}`
      + ` waiting=${movedSeating.waiting} cells=${movedSeating.cells} boxM=${movedSeating.boxM}`);
    const moved = await measureFloor(page, 40);
    assertFloor('after pan', moved);
    await shoot(page, 'traffic-floor-moved.png');

    console.log(`\n  · /api/terrain/heights refused ${demRefused}×`);

    const failed = results.filter((r) => r.ok === false);
    console.log(`\n${failed.length ? '\x1b[31m' : '\x1b[32m'}${results.length - failed.length}/${results.length} controls passed\x1b[0m`);
    if (failed.length) exitCode = 1;
  } catch (error) {
    console.error(`\x1b[31mHarness error: ${error?.stack || error}\x1b[0m`);
    exitCode = 2;
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
}

main();
