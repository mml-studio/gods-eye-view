#!/usr/bin/env node
/**
 * qa-transit-floor.mjs — headless proof that a live transit glyph sits on the
 * drawn street FROM ITS FIRST FRAME, not twenty seconds later.
 *
 * ── The defect this guards ──────────────────────────────────────────────────
 * `vehiclePosition` used to read `cachedGroundFloor` — which answers over the
 * NETWORK — and fall back to `0` when the cell was cold. `warmGroundFloor` is
 * only posted at the END of a reconcile, so the first poll of every viewport
 * took every position from a cold cache and drew the whole fleet on the WGS84
 * ellipsoid. MEASURED in the app over Tours (47.3906, 0.6929, camera 900 m at
 * −35°, 2026-09-15), mesh drained:
 *
 *   at first draw   drawn − own floor: median −98.4 m, worst −147.3 m
 *   ~20 s later     +4.0 m — the second poll re-read the warmed cells
 *   on screen       median 17.5 px from the street, 131.1 px at p90
 *
 * The glyphs draw with `disableDepthTestDistance: Infinity` so a bus is never
 * swallowed by the kerb it stands on, so a buried one is painted anyway and its
 * screen position becomes a function of the CAMERA POSE: buses sitting in tree
 * canopies and on rooftops, sliding as the view turns. That is the report this
 * harness answers. The fix is `provisionalFloor.js`, sampled BEFORE the
 * positions are taken — the same one `sharedMobilityFrance.js` already uses.
 *
 * Controls, in the order they would fail:
 *   (i)   AT FIRST DRAW — every glyph within `LIFT_TOLERANCE_M` of
 *         `GLYPH_LIFT_M` above the floor its own coordinate reports, measured
 *         as soon as the layer puts anything on the globe. THE control: run
 *         against `8e9b592` it reports `149 drawn 9 ms in, lift −149.8…−85.7 m,
 *         heights 4…4 m` — the whole fleet on the ellipsoid — and the same
 *         control after the drain still finds glyphs at −128.6 m, because a
 *         parked bus never re-reads anything on its own.
 *   (ii)  IN BAND — no glyph outside the plausible French band. A COARSE
 *         guard, and honestly so: it does not catch this defect at all (4 m
 *         ellipsoidal is inside it, and the pre-fix build passes it), it
 *         catches the OTHER way a probe fails — the −11 838 m and +340 m reads
 *         a mid-stream tileset returns.
 *   (iii) ON THE MESH — median |glyph − sampleHeight| within tolerance, with
 *         BOTH transit collections hidden for the probes: an unhidden probe
 *         reads a bus and reports a perfect zero.
 *   (iv)  ON SCREEN — median pixel distance to the mesh point underneath,
 *         counted only over glyphs inside the frustum. Also coarse: the
 *         pre-fix build passes it whenever the sampled glyphs happen to be
 *         ones a later poll already rescued.
 *   (v)   SURVIVES A PAN — the same assertions after a move that re-fetches
 *         the viewport and re-seats a fleet while tiles stream again.
 *
 * Waits on the layer's OWN signal (`floorCold`, `floorPending` in `getStats`),
 * never on a stopwatch: seating time is dominated by probe cost, which under
 * SwiftShader is machine load and not this layer.
 *
 * Measured 2026-09-15: 6/9 on `8e9b592`, 9/9 with the fix.
 *
 * Run:  node scripts/qa-transit-floor.mjs --url http://localhost:4173
 * Exits non-zero on any FAIL. Commits nothing.
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
const APP_URL = getOpt('--url', 'http://localhost:4173');
const HEADFUL = argv.includes('--headful');

/**
 * Tours, and not Bordeaux where the rest of the transit fleet is tested.
 *
 * Two live networks overlap here — Fil Bleu inside the city, Rémi across the
 * region — so one viewport holds both a dense urban fleet and coaches out on
 * the suburban relief, and the ground under them spans ~90 to ~160 m
 * ellipsoidal. It is the ground the defect was reported over.
 *
 * Higher and flatter than the report's own 160 m camera on purpose: the
 * on-screen control can only count glyphs inside the FRUSTUM, and at 900 m
 * over a 10 km fetch box that was six of them. At 2 200 m it is tens, which is
 * a median worth reading.
 */
const VIEW = { lat: 47.3906, lon: 0.6929, alt: 2200, heading: 20, pitch: -50 };
/** The same box shifted ~900 m, enough to re-fetch and re-seat. */
const MOVED = { ...VIEW, lon: VIEW.lon + 0.012 };

/** `GLYPH_LIFT_M` in `src/data/transitFrance.js`. */
const GLYPH_LIFT_M = 4;
/**
 * Metres of slack on the lift.
 *
 * Three, not one: the harness reads the floor under the DRAWN coordinate, and
 * a projected vehicle is drawn a few hundred metres along its run from the fix
 * whose cell seated it. Those are different ~111 m cells, so the honest
 * residual is one cell of GRADE — 1.3 m measured over this view. Anything
 * beyond that is a glyph standing on a number nobody measured, which is the
 * defect.
 */
const LIFT_TOLERANCE_M = 3;
/** Ellipsoidal metres a French bus can plausibly sit at (geoid included). */
const BAND_MIN_M = -100;
const BAND_MAX_M = 3000;
/**
 * Allowed median gap to the mesh, metres.
 *
 * Larger than the traffic layer's 6 m, and for a reason worth writing down:
 * a road is seated ON its own probe, where a bus is seated on the DEM cell its
 * coordinate falls in, and in a city those two disagree by the photogrammetric
 * mesh's own thickness — a canopy over a suburban road, a facade beside a
 * narrow street. Measured over this view after the fix: median +2.6 m with a
 * p10 of −22.8 m, all of the latter on wooded ground south of the city.
 */
const MAX_MEDIAN_GAP_M = 8;
/** Pixels — allowed median on-screen gap at the harness canvas. */
const MAX_MEDIAN_PX = 15;
/** Probes bought by the harness itself per measurement pass. */
const PROBE_SAMPLE = 60;

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  // The INSTALLED Chrome first: Chrome for Testing cannot pick Cesium entities
  // on this machine, and a probe that cannot pick reads nothing.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* unreadable */ }
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashFor(view) {
  return `#lat=${view.lat}&lon=${view.lon}&alt=${view.alt}`
    + `&heading=${view.heading}&pitch=${view.pitch}`;
}

/** Wait for the visible tileset to drain its streaming queue. */
async function waitForMesh(page, timeoutMs = 120000) {
  try {
    await page.waitForFunction(() => {
      const scene = window.__godsEyeView?.viewer?.scene;
      if (!scene) return false;
      try { scene.render(); } catch { /* stalled context */ }
      for (let i = 0; i < scene.primitives.length; i++) {
        const primitive = scene.primitives.get(i);
        if (primitive?.constructor?.name === 'Cesium3DTileset' && primitive.show) {
          return !!primitive.tilesLoaded;
        }
      }
      return false;
    }, { polling: 1000, timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Poll the layer until it has a fleet and has stopped loading. */
async function settleFleet(page, { minCount = 1, timeoutS = 60 } = {}) {
  let stats = null;
  for (let i = 0; i < timeoutS; i++) {
    stats = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      try { gev.viewer.scene.render(); } catch { /* stalled context */ }
      return gev.dataManager.layers.get('transit-fr').module.getStats();
    });
    if (stats.count >= minCount && !stats.loading) break;
    await sleep(1000);
  }
  return stats;
}

/**
 * Wait until the layer actually PUTS something on the globe, and say how long
 * it took.
 *
 * Not the same question as "has it loaded". A glyph whose ground nothing can
 * speak for is deliberately withheld (`record.floorKnown`), so between the
 * payload landing and the first floor answering there is a short window with a
 * fleet counted and nothing drawn. That window is the price of never drawing a
 * bus on the ellipsoid, and it is bounded by one DEM round trip — measured at
 * ~1.1 s over Tours. A harness that measured before it closed would be reading
 * an empty scene and calling it a pass.
 *
 * @returns {Promise<{drawn: number, ms: number}>}
 */
async function waitForDrawn(page, timeoutS = 20) {
  const started = Date.now();
  let drawn = 0;
  for (let i = 0; i < timeoutS * 4; i++) {
    drawn = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      try { gev.viewer.scene.render(); } catch { /* stalled context */ }
      return gev.dataManager.layers.get('transit-fr').module
        .getDetectableObjects({ maxCount: 5000 }).length;
    });
    if (drawn > 0) break;
    await sleep(250);
  }
  return { drawn, ms: Date.now() - started };
}

/**
 * Wait for the layer to say it has finished placing itself.
 *
 * Its own two signals, not a stopwatch: `floorCold` means some glyph still
 * stands on no measured floor at all, `floorPending` counts cells a later pass
 * could still improve. A harness that slept a fixed time here would be
 * measuring machine load. Returns the last state either way — failing to
 * converge is a result, not a reason to hang.
 */
async function waitForSeating(page, timeoutS = 60) {
  let stats = null;
  for (let i = 0; i < timeoutS * 2; i++) {
    stats = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      try { gev.viewer.scene.render(); } catch { /* stalled context */ }
      return gev.dataManager.layers.get('transit-fr').module.getStats();
    });
    if (stats.floorCold === false && !stats.floorPending) return stats;
    await sleep(500);
  }
  return stats;
}

/**
 * Read every drawn glyph's height against the floor its own coordinate
 * reports, and against the mesh directly beneath it.
 */
async function measureFloor(page, sampleSize) {
  return page.evaluate(async (maxCount, minM, maxM) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe.ellipsoid;
    const groundFloor = await import('/src/data/groundFloor.js');
    const provisional = await import('/src/data/provisionalFloor.js');
    const module = gev.dataManager.layers.get('transit-fr').module;

    const floorAt = (lat, lon) => {
      const dem = groundFloor.cachedGroundFloor(lat, lon);
      if (Number.isFinite(dem)) return dem;
      const guess = provisional.provisionalFloor(lat, lon);
      return Number.isFinite(guess) ? guess : null;
    };

    // EVERY glyph, for the band and lift checks — one buried bus is the defect.
    const glyphs = [];
    for (const contact of module.getDetectableObjects({ maxCount: 5000 })) {
      if (!contact?.position) continue;
      const carto = ellipsoid.cartesianToCartographic(contact.position);
      if (!carto) continue;
      glyphs.push({
        position: contact.position,
        lonRad: carto.longitude,
        latRad: carto.latitude,
        // Converted by hand: `window.Cesium` has not existed since the layer
        // split, and importing it here would load a second copy of the engine.
        lat: (carto.latitude * 180) / Math.PI,
        lon: (carto.longitude * 180) / Math.PI,
        height: carto.height,
      });
    }

    const heights = glyphs.map((g) => g.height).sort((a, b) => a - b);
    const outOfBand = heights.filter((h) => h < minM || h > maxM).length;

    // Lift: what the layer itself claims to have done.
    const lifts = [];
    for (const glyph of glyphs) {
      const floor = floorAt(glyph.lat, glyph.lon);
      if (floor === null) continue;
      lifts.push(glyph.height - floor);
    }

    // The mesh comparison. BOTH transit collections are hidden for the whole
    // run of probes: they are pickable billboards standing on the very cells
    // being probed, and an unhidden probe reads a bus instead of the street.
    const hidden = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const primitive = scene.primitives.get(i);
      const kind = primitive?.constructor?.name;
      if (kind === 'BillboardCollection' || kind === 'PointPrimitiveCollection') {
        hidden.push({ primitive, show: primitive.show });
        primitive.show = false;
      }
    }
    const gaps = [];
    const signed = [];
    const pixels = [];
    let onScreen = 0;
    try {
      // PROBE WHAT IS BEING LOOKED AT. A viewport of this layer is ~10 km
      // across where the frustum at 900 m holds a couple of kilometres, so a
      // stride over the whole fleet spends its budget out of frame — measured
      // here, 3 of 52 samples were on the canvas, and the on-screen median was
      // computed from two of them. Glyphs inside the canvas come first; the
      // rest only fill a budget they leave over.
      const insideCanvas = (position) => {
        const p = scene.cartesianToCanvasCoordinates(position);
        return p && Number.isFinite(p.x) && Number.isFinite(p.y)
          && p.x >= 0 && p.y >= 0
          && p.x <= scene.canvas.clientWidth && p.y <= scene.canvas.clientHeight;
      };
      const visible = glyphs.filter((g) => insideCanvas(g.position));
      const offscreen = glyphs.filter((g) => !insideCanvas(g.position));
      onScreen = visible.length;
      const ordered = visible.concat(offscreen);
      const stride = Math.max(1, Math.ceil(ordered.length / maxCount));
      for (let i = 0; i < ordered.length; i += stride) {
        const glyph = ordered[i];
        let mesh = null;
        try {
          const h = scene.sampleHeight({
            longitude: glyph.lonRad, latitude: glyph.latRad, height: 0,
          });
          if (Number.isFinite(h)) mesh = h;
        } catch { /* mid-teardown */ }
        if (mesh === null) continue;
        gaps.push(Math.abs(glyph.height - mesh));
        signed.push(glyph.height - mesh);
        const onMesh = ellipsoid.cartographicToCartesian({
          longitude: glyph.lonRad, latitude: glyph.latRad, height: mesh,
        });
        // The on-screen error is only a fact about glyphs that are on screen:
        // `cartesianToCanvasCoordinates` answers for a point behind the camera
        // with coordinates that mean nothing, and one of those was reporting
        // a 127 px error on a glyph nobody could see.
        if (!insideCanvas(glyph.position)) continue;
        const a = scene.cartesianToCanvasCoordinates(glyph.position);
        const b = scene.cartesianToCanvasCoordinates(onMesh);
        if (a && b) pixels.push(Math.hypot(a.x - b.x, a.y - b.y));
      }
    } finally {
      for (const entry of hidden) entry.primitive.show = entry.show;
    }

    const at = (arr, p) => (arr.length
      ? +arr.slice().sort((x, y) => x - y)[Math.floor(p * (arr.length - 1))].toFixed(1)
      : null);
    const stats = module.getStats();
    return {
      count: glyphs.length,
      onScreen,
      stats: {
        count: stats.count,
        loading: stats.loading,
        floorCold: stats.floorCold,
        floorPending: stats.floorPending,
      },
      heightMin: heights.length ? +heights[0].toFixed(1) : null,
      heightMax: heights.length ? +heights[heights.length - 1].toFixed(1) : null,
      outOfBand,
      lifted: lifts.length,
      liftMin: at(lifts, 0),
      liftMedian: at(lifts, 0.5),
      liftMax: lifts.length ? +Math.max(...lifts).toFixed(1) : null,
      probed: gaps.length,
      gapMedianM: at(gaps, 0.5),
      signedP10: at(signed, 0.1),
      signedMedian: at(signed, 0.5),
      pxMedian: at(pixels, 0.5),
      pxP90: at(pixels, 0.9),
    };
  }, sampleSize, BAND_MIN_M, BAND_MAX_M);
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ }
    });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/** How many of the probes landed on a glyph that is actually on the canvas. */
function pixelsCounted(m) {
  return `${m.onScreen}`;
}

function assertSeated(label, m, { lift = true } = {}) {
  console.log(`  · ${m.stats.count} glyphs, floorCold=${m.stats.floorCold},`
    + ` floorPending=${m.stats.floorPending}`);
  if (lift) {
    const low = GLYPH_LIFT_M - LIFT_TOLERANCE_M;
    const high = GLYPH_LIFT_M + LIFT_TOLERANCE_M;
    record(
      `${label} — every glyph stands on its own floor (${low}…${high} m above it)`,
      m.lifted > 0 && m.liftMin >= low && m.liftMax <= high
        && m.stats.floorCold === false,
      `${m.lifted}/${m.count} measurable, lift ${m.liftMin}…${m.liftMax} m`
      + ` (median ${m.liftMedian}), floorCold=${m.stats.floorCold}`,
    );
  }
  record(
    `${label} — no buried glyph (band ${BAND_MIN_M}…${BAND_MAX_M} m)`,
    m.count > 0 && m.outOfBand === 0,
    `${m.count} glyphs, ${m.outOfBand} out of band, heights ${m.heightMin}…${m.heightMax} m`,
  );
  record(
    `${label} — glyphs sit on the mesh (median ≤ ${MAX_MEDIAN_GAP_M} m)`,
    m.probed > 0 && m.gapMedianM !== null && m.gapMedianM <= MAX_MEDIAN_GAP_M,
    `${m.probed} probes, |gap| median ${m.gapMedianM} m,`
    + ` signed median ${m.signedMedian} m, p10 ${m.signedP10} m`,
  );
  record(
    `${label} — on-screen error (median ≤ ${MAX_MEDIAN_PX} px)`,
    m.pxMedian !== null && m.pxMedian <= MAX_MEDIAN_PX,
    `${pixelsCounted(m)} on-screen glyphs, median ${m.pxMedian} px, p90 ${m.pxP90} px`,
  );
}

async function main() {
  console.log('\nTransit Ground-Seating Proof (qa-transit-floor)');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  View    : Tours ${VIEW.lat}, ${VIEW.lon} @ ${VIEW.alt} m, pitch ${VIEW.pitch}°\n`);

  try {
    const response = await fetch(APP_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`\x1b[31mDev server not reachable at ${APP_URL} (${error.message}).\x1b[0m`);
    process.exit(2);
  }

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    protocolTimeout: 900000,
    ...(findChrome() ? { executablePath: findChrome() } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--disable-web-security',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });

  let exitCode = 0;
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[Data:Transit')) console.log(`  · ${text}`);
    });

    console.log('Loading app...');
    await page.goto(`${APP_URL}/${hashFor(VIEW)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => !!window.__godsEyeView?.viewer && !!window.__godsEyeView?.dataManager,
      { polling: 200, timeout: 60000 },
    );

    // The user's real flow: the layer comes on and the fleet is drawn at once.
    // Enabling AFTER the DEM has had twenty seconds hides the defect entirely.
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('transit-fr', true));
    const first = await settleFleet(page);
    console.log(`  · fleet settled: ${first.count} vehicles (${first.loadingLabel || 'no label'})`);
    if (!first.count) {
      record('a fleet was loaded at all', null, 'no live vehicle in this viewport right now');
      console.log('\n\x1b[33mINCONCLUSIVE — nothing was reporting over Tours.\x1b[0m');
      await browser.close();
      process.exit(0);
    }

    console.log('\n(i) At first draw — before anything has had time to converge');
    const appeared = await waitForDrawn(page);
    console.log(`  · first glyph on the globe ${appeared.ms} ms after the payload`);
    const fresh = await measureFloor(page, PROBE_SAMPLE);
    // The mesh may still be streaming here, so only the layer's OWN claim is
    // asserted: no glyph may stand on a number nobody measured. The mesh and
    // pixel checks below are reported for the record and re-asserted after the
    // drain, where they mean something.
    const lowLift = GLYPH_LIFT_M - LIFT_TOLERANCE_M;
    const highLift = GLYPH_LIFT_M + LIFT_TOLERANCE_M;
    record(
      'at first draw — every glyph the layer puts up stands on a measured floor',
      fresh.count > 0 && fresh.outOfBand === 0
        && fresh.lifted > 0 && fresh.liftMin >= lowLift && fresh.liftMax <= highLift,
      `${fresh.count} drawn ${appeared.ms} ms in,`
      + ` lift ${fresh.liftMin}…${fresh.liftMax} m over ${fresh.lifted} measurable cells,`
      + ` heights ${fresh.heightMin}…${fresh.heightMax} m, ${fresh.outOfBand} out of band`,
    );
    await shoot(page, 'transit-floor-first-draw.png');

    console.log('\nWaiting for the photorealistic mesh to drain...');
    const drained = await waitForMesh(page);
    console.log(`  · tileset drained: ${drained}`);
    const seated = await waitForSeating(page);
    console.log(`  · seating: floorCold=${seated.floorCold} floorPending=${seated.floorPending}`);

    console.log('\n(ii)–(iv) Parked, after the drain');
    const parked = await measureFloor(page, PROBE_SAMPLE);
    assertSeated('parked', parked);
    await shoot(page, 'transit-floor-parked.png');

    console.log('\n(v) After a ~900 m pan (re-fetch and re-seat while tiles stream)');
    await page.evaluate((view) => {
      const gev = window.__godsEyeView;
      const ellipsoid = gev.viewer.scene.globe.ellipsoid;
      const d2r = Math.PI / 180;
      try { gev.viewer.camera.cancelFlight(); } catch { /* none active */ }
      gev.viewer.camera.setView({
        destination: ellipsoid.cartographicToCartesian({
          longitude: view.lon * d2r, latitude: view.lat * d2r, height: view.alt,
        }),
        orientation: { heading: view.heading * d2r, pitch: view.pitch * d2r, roll: 0 },
      });
      // `setView` raises neither `changed` nor `moveEnd`, so the layer would
      // never re-read the box a real drag would have given it.
      gev.viewer.camera.changed.raiseEvent(1);
    }, MOVED);
    await settleFleet(page);
    await waitForMesh(page);
    const movedSeating = await waitForSeating(page);
    console.log(`  · seating: floorCold=${movedSeating.floorCold}`
      + ` floorPending=${movedSeating.floorPending}`);
    const moved = await measureFloor(page, PROBE_SAMPLE);
    assertSeated('after pan', moved);
    await shoot(page, 'transit-floor-moved.png');

    const failed = results.filter((r) => r.ok === false);
    const colour = failed.length ? '\x1b[31m' : '\x1b[32m';
    console.log(`\n${colour}${results.length - failed.length}/${results.length} controls passed\x1b[0m`);
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
