#!/usr/bin/env node
/**
 * Browser proof that an urbanism permit is drawn on the ground it describes.
 *
 * THE DEFECT THIS EXISTS FOR. Measured in this app over Paris on 2026-09-14,
 * camera at 500 m: all 4 753 dots of `sitadel-fr` sat at ellipsoidal height
 * 1.0 m, while `scene.sampleHeight` read the drawn Google mesh under those same
 * coordinates at 76.7 to 96.9 m. The dots draw with
 * `disableDepthTestDistance: Infinity`, so one 80 m under the city is painted
 * anyway — and its screen position is then a function of the CAMERA POSE. Turn
 * the map and the whole layer slides across the rooftops, landing on no parcel
 * at all. `drawPack` read a DEM that answers over the network, took `0` for the
 * miss, and never wrote a position again.
 *
 * WHAT IS ASSERTED, AND WHY IT IS MEASURED THIS WAY. Nothing here reads a
 * pixel: a Cesium entity never paints in Puppeteer on this machine, so the
 * model is the only honest evidence. The parallax claim is checked as geometry
 * instead — the CANVAS GAP between a dot and a mark at its own coordinate on
 * the drawn surface. A dot standing on its ground projects onto it at every
 * camera pose; a buried one does not, and the gap grows with obliquity. That
 * gap is the reported symptom in pixels.
 *
 *   i.   one dot per placed permit, and the pack is the fixture's
 *   ii.  no dot is left on the ellipsoid — each stands within
 *        {@link SEAT_TOLERANCE_M} of the surface under it
 *   iii. the mark does not slide: the canvas gap stays under
 *        {@link PARALLAX_MAX_PX} at a nadir camera AND at an oblique, rotated
 *        one, which is the pose the report was made from
 *   iv.  the selected card and the DETECT callout stand on the dot's own floor,
 *        so a label and its mark are never in two places
 *
 * Run: node scripts/qa-sitadel-floor.mjs --url http://localhost:5199
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import {
  communeCadastreCodes,
  indexCadastreParcels,
  projectSitadelCommune,
} from '../src/data/sitadelFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(REPO_ROOT, 'src', 'data', 'fixtures');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'sitadel-floor');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
/**
 * Let the terrain proxy answer. OFF by default, and that default IS the test.
 *
 * The DEM is the source this layer used to depend on entirely, and the run that
 * found the defect is the run where it did not answer: over Paris on
 * 2026-09-14 the three `/api/terrain/heights` calls came back 200 and not one
 * dot ever left the ellipsoid. A harness that lets the DEM answer measures a
 * layer redrawing itself after a network round trip and passes on the broken
 * code — verified, same file, same numbers. Refusing the proxy holds the layer
 * to the claim that actually matters: a permit is seated on the surface being
 * DRAWN, whatever the network is doing.
 *
 * `--dem` restores it, for a run that wants to see the two sources agree.
 */
const ALLOW_DEM = args.includes('--dem');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nantes — the commune this repo ships a full Sitadel + cadastre fixture for. */
const CITY = { lon: -1.5536, lat: 47.2184 };

/**
 * Metres a dot may stand off the surface read under its own coordinate.
 *
 * 25 m, and the band is loose ON PURPOSE because the REFERENCE is loose. A
 * permit's anchor is its parcel's centroid, and in a built commune that
 * centroid usually has a building on it — so `sampleHeight` there reads the
 * ROOF, not the street the dot belongs on. A dot correctly seated on the ground
 * under a mid-rise therefore reads as "below the surface" by the height of the
 * building, which is a property of the question and not a defect.
 *
 * The tight claim is {@link MEDIAN_SEAT_TOLERANCE_M} below. This one is the
 * catastrophe guard: the defect it exists for put EVERY dot 76.7–96.9 m under
 * the city, and no French building saves a run from that.
 */
const SEAT_TOLERANCE_M = 25;

/**
 * Metres the MEDIAN dot may stand off the surface.
 *
 * 5 m — comfortably above the ~111 m cell's own relief and the mesh-versus-DEM
 * disagreement (+1.2 m mean, measured over the Landes), and far below a roof.
 * Half the pack standing this close to the drawn surface is what "the layer is
 * seated" means; one dot under a roof cannot buy it.
 */
const MEDIAN_SEAT_TOLERANCE_M = 5;

/**
 * Canvas pixels a mark may sit from its own ground point.
 *
 * 40 px at 1600 × 1000. The pre-fix measurement on the sibling defect was a
 * median of 140 px and a worst case of 272 px (`renderedSurface.js`), so this
 * is comfortably inside the failure and comfortably outside the residual a
 * 12 m seating error projects to at this camera.
 */
const PARALLAX_MAX_PX = 40;

/** Minimum dots the fixture must put on screen for the run to mean anything. */
const MIN_DOTS = 5;
/** Minimum dots that must land ON the canvas for the slide claim to mean one. */
const MIN_ON_CANVAS = 3;
/**
 * Oblique stands the slide is measured from.
 *
 * Four, because this fixture's nine permits are spread over a 12 km commune and
 * a street-level camera holds ONE of them. Measuring four separate parcels
 * beats measuring one four times: a floor that only happens to be right under
 * one parcel is a coincidence, and four of them are not.
 */
const SLIDE_STANDS = 4;

/** The oblique stand: 28.6° down, turned 45° off north, 450 m up. */
const SLIDE_HEADING = Math.PI / 4;
const SLIDE_PITCH = -0.5;
const SLIDE_CAMERA_M = 450;
/** Rough ellipsoidal height of this commune's ground, for the standoff maths. */
const CITY_GROUND_M = 75;

/**
 * Where the camera has to STAND for `target` to be in front of it.
 *
 * Setting the camera at the anchor and tilting puts the anchor below and behind
 * the lens — two of four stands measured nothing at all that way. The camera
 * belongs one standoff back along the reverse azimuth, at the horizontal
 * distance the pitch implies.
 *
 * @param {{lat: number, lon: number}} target
 * @param {number} heading Radians, clockwise from north.
 * @param {number} pitch Radians, negative looking down.
 * @param {number} cameraM Ellipsoidal camera height.
 * @returns {{lat: number, lon: number}} Where to put the camera.
 */
function standoff(target, heading, pitch, cameraM) {
  const rangeM = (cameraM - CITY_GROUND_M) / Math.tan(Math.abs(pitch));
  const azimuth = heading + Math.PI; // behind the target, looking at it
  const metresPerDegLat = 111320;
  const metresPerDegLon = metresPerDegLat * Math.cos(target.lat * Math.PI / 180);
  return {
    lat: target.lat + (rangeM * Math.cos(azimuth)) / metresPerDegLat,
    lon: target.lon + (rangeM * Math.sin(azimuth)) / metresPerDegLon,
  };
}

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

/**
 * The Nantes pack, projected here exactly as the proxy projects it.
 *
 * A fixture and not the live proxy: the assertions below are about GEOMETRY,
 * and a pack that changes with the month would make a failure unreadable.
 */
function nantesPack() {
  const housing = read('sitadel-logements-44109-sample.json');
  const demolition = read('sitadel-demolir-44109-sample.json');
  const cadastre = read('sitadel-cadastre-44109-sample.json');
  const commune = read('sitadel-commune-44109-sample.json')[0];
  const { index, parcels } = indexCadastreParcels([cadastre]);
  return {
    ...projectSitadelCommune({
      housing,
      demolition,
      index,
      commune,
      outline: {
        parts: [[commune.contour.coordinates[0]]],
        simplified: true,
        sourceParts: 1,
        servedParts: 1,
      },
      millesime: '2026-08',
      cadastreEdition: '2026-06-01',
      cadastreCommunes: communeCadastreCodes('44109'),
      cadastreParcels: parcels,
    }),
    fetchedAt: Date.now(),
    stale: false,
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/** Render frames explicitly — headless WebGL can stall the rAF loop outright. */
async function pump(page, frames = 8, gapMs = 120) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

async function setView(page, {
  heading = 0, pitch = -Math.PI / 2, height = 500, lon = CITY.lon, lat = CITY.lat,
} = {}) {
  await page.evaluate((lo, la, h, hd, pi) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lo * d2r, latitude: la * d2r, height: h,
      }),
      orientation: { heading: hd, pitch: pi, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height, heading, pitch);
  await pump(page, 6, 150);
}

/**
 * Read every dot off the SCENE — its coordinate, the height it was drawn at,
 * the surface actually under it, and the canvas gap between the two.
 *
 * Read off the primitive rather than off the layer's own record on purpose: a
 * record that agrees with the ground while the sprite does not is this bug with
 * a passing test.
 */
async function probeDots(page, budget) {
  return page.evaluate((maxProbes) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const primitives = scene.primitives;
    let collection = null;
    for (let i = 0; i < primitives.length; i++) {
      const candidate = primitives.get(i);
      if (typeof candidate?.get !== 'function' || !candidate.length) continue;
      const first = candidate.get(0);
      if (typeof first?.id === 'string' && first.id.startsWith('sitadel-fr:')) {
        collection = candidate;
        break;
      }
    }
    if (!collection) return { total: 0, dots: [] };

    // Sampled rather than exhaustive: `sampleHeight` forces a synchronous
    // offscreen pick render (~6 ms headless), and the claim is about the layer,
    // not about one dot.
    const stride = Math.max(1, Math.ceil(collection.length / maxProbes));
    const dots = [];
    for (let i = 0; i < collection.length; i += stride) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      if (!carto) continue;
      const drawnM = carto.height;
      let surfaceM = null;
      try {
        const probe = ellipsoid.cartesianToCartographic(point.position);
        probe.height = 0;
        const height = scene.sampleHeight(probe);
        surfaceM = Number.isFinite(height) ? height : null;
      } catch { /* scene mid-teardown */ }
      let gapPx = null;
      let onCanvas = false;
      if (surfaceM != null) {
        const onGround = ellipsoid.cartographicToCartesian({
          longitude: carto.longitude, latitude: carto.latitude, height: surfaceM,
        });
        const a = scene.cartesianToCanvasCoordinates(point.position);
        const b = scene.cartesianToCanvasCoordinates(onGround);
        if (a && b) {
          gapPx = Math.hypot(a.x - b.x, a.y - b.y);
          // A commune is 12 km across and a 500 m camera sees ~600 m of it, so
          // most of the pack is off screen — and a projection extrapolated past
          // the canvas edge exaggerates the same height error into hundreds of
          // pixels. The claim is about what a reader is looking at, so the gap
          // is only counted where a reader could see it.
          const { clientWidth: w, clientHeight: h } = scene.canvas;
          onCanvas = b.x >= 0 && b.x <= w && b.y >= 0 && b.y <= h;
        }
      }
      dots.push({ id: point.id, drawnM, surfaceM, gapPx, onCanvas });
    }
    return { total: collection.length, dots };
  }, budget);
}

function summarise(dots) {
  const seated = dots.filter((dot) => dot.surfaceM != null);
  const offsets = seated.map((dot) => Math.abs(dot.drawnM - dot.surfaceM)).sort((a, b) => a - b);
  const gaps = dots.filter((dot) => dot.onCanvas && Number.isFinite(dot.gapPx))
    .map((dot) => dot.gapPx).sort((a, b) => a - b);
  const round = (value) => Math.round(value * 10) / 10;
  return {
    probed: seated.length,
    onCanvas: gaps.length,
    medianOffsetM: offsets.length ? round(offsets[Math.floor(offsets.length / 2)]) : null,
    worstOffsetM: offsets.length ? round(offsets[offsets.length - 1]) : null,
    worstGapPx: gaps.length ? round(gaps[gaps.length - 1]) : null,
    medianGapPx: gaps.length ? round(gaps[Math.floor(gaps.length / 2)]) : null,
    drawnRangeM: seated.length
      ? [round(Math.min(...seated.map((d) => d.drawnM))), round(Math.max(...seated.map((d) => d.drawnM)))]
      : null,
    surfaceRangeM: seated.length
      ? [round(Math.min(...seated.map((d) => d.surfaceM))), round(Math.max(...seated.map((d) => d.surfaceM)))]
      : null,
  };
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const pack = nantesPack();
  console.log(`Fixture: ${pack.commune} (${pack.insee}) — ${pack.summary.placed} placed permits`);

  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 120000,
  });
  const page = await newQaPage(browser);
  await page.setRequestInterception(true);
  let demCalls = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/sitadel-fr/commune')) {
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pack),
      }).catch(() => {});
      return;
    }
    if (!ALLOW_DEM && url.includes('/api/terrain/heights')) {
      demCalls += 1;
      request.respond({ status: 503, contentType: 'application/json', body: '{}' }).catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  });

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 90000 },
    );
    await setView(page);

    console.log('\nThe layer draws the fixture');
    await page.evaluate(
      () => window.__godsEyeView.dataManager.setEnabled('sitadel-fr', true, { origin: 'user' }),
    );
    let drawn = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      await pump(page, 3, 200);
      drawn = (await probeDots(page, 1)).total;
      if (drawn > 0) break;
    }
    check('one dot per placed permit', drawn === pack.summary.placed, `${drawn} drawn of ${pack.summary.placed}`);
    check(`at least ${MIN_DOTS} dots to measure`, drawn >= MIN_DOTS, `${drawn} drawn`);

    // The floors land over the seconds that follow — the DEM over the network,
    // the mesh as the tiles stream. This is the settle the ladder exists for.
    await pump(page, 40, 250);

    // Nine permits are spread over a 12 km commune and a 500 m camera sees
    // ~600 m of it, so the commune centre frames none of them. Read the anchors
    // out of the pack and park on them one at a time instead: street altitude
    // is the only camera where a canvas gap means anything, and it can only
    // ever hold one of this fixture's permits.
    const anchorList = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const module = gev.dataManager.layers.get('sitadel-fr')?.module;
      const marks = (module?.getDetectableObjects?.({ maxCount: 500 }) || []);
      const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
      const r2d = 180 / Math.PI;
      return marks.map((mark) => {
        const carto = ellipsoid.cartesianToCartographic(mark.position);
        return { lon: carto.longitude * r2d, lat: carto.latitude * r2d };
      });
    });
    check('the pack published anchors to frame', anchorList.length > 0);
    const target = anchorList[0] || CITY;

    console.log('\nNadir camera — no dot is left on the ellipsoid');
    await setView(page, { ...target, height: 500 });
    await pump(page, 24, 250);
    const nadir = await probeDots(page, 24);
    const nadirStats = summarise(nadir.dots);
    console.log(`  · ${JSON.stringify(nadirStats)}`);
    check('the drawn surface answered under the dots', nadirStats.probed > 0,
      'sampleHeight returned nothing — the mesh never streamed, this run proves nothing');
    if (!ALLOW_DEM) {
      console.log(`  · the terrain proxy was refused ${demCalls} time(s) — every floor below`
        + ' came off the drawn surface');
    }
    check(`the median dot is within ${MEDIAN_SEAT_TOLERANCE_M} m of the surface`,
      nadirStats.medianOffsetM != null && nadirStats.medianOffsetM <= MEDIAN_SEAT_TOLERANCE_M,
      `median ${nadirStats.medianOffsetM} m`);
    const buried = nadir.dots.filter((dot) => dot.surfaceM != null
      && Math.abs(dot.drawnM - dot.surfaceM) > SEAT_TOLERANCE_M);
    check(`no dot more than ${SEAT_TOLERANCE_M} m from the surface under it`, buried.length === 0,
      `${buried.length} of ${nadirStats.probed} off by up to ${nadirStats.worstOffsetM} m`);

    console.log('\nOblique, rotated cameras — the pose the slide was reported from');
    const gaps = [];
    for (const anchor of anchorList.slice(0, SLIDE_STANDS)) {
      await setView(page, { ...standoff(anchor, SLIDE_HEADING, SLIDE_PITCH, SLIDE_CAMERA_M),
        heading: SLIDE_HEADING, pitch: SLIDE_PITCH, height: SLIDE_CAMERA_M });
      await pump(page, 16, 200);
      const stand = summarise((await probeDots(page, 24)).dots);
      if (stand.worstGapPx != null) gaps.push({ anchor, ...stand });
      console.log(`  · ${anchor.lat.toFixed(5)},${anchor.lon.toFixed(5)} → `
        + `${stand.onCanvas} on canvas, worst ${stand.worstGapPx} px`);
    }
    const worstGapPx = gaps.length ? Math.max(...gaps.map((gap) => gap.worstGapPx)) : null;
    const measured = gaps.reduce((total, gap) => total + gap.onCanvas, 0);
    check(`at least ${MIN_ON_CANVAS} marks on canvas across the stands`,
      measured >= MIN_ON_CANVAS, `${measured} measured over ${gaps.length} stands`);
    check(`the marks do not slide (≤ ${PARALLAX_MAX_PX} px)`,
      worstGapPx != null && worstGapPx <= PARALLAX_MAX_PX, `worst ${worstGapPx} px`);

    console.log('\nThe label stands where its mark stands');
    const anchors = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const scene = gev.viewer.scene;
      const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
      const primitives = scene.primitives;
      let collection = null;
      for (let i = 0; i < primitives.length; i++) {
        const candidate = primitives.get(i);
        if (typeof candidate?.get !== 'function' || !candidate.length) continue;
        const first = candidate.get(0);
        if (typeof first?.id === 'string' && first.id.startsWith('sitadel-fr:')) {
          collection = candidate;
          break;
        }
      }
      if (!collection) return null;
      const byId = new Map();
      for (let i = 0; i < collection.length; i++) {
        const point = collection.get(i);
        byId.set(point.id, ellipsoid.cartesianToCartographic(point.position).height);
      }
      const module = gev.dataManager.layers.get('sitadel-fr')?.module;
      const detections = module?.getDetectableObjects?.({ maxCount: 20 }) || [];
      return detections
        .filter((entry) => byId.has(entry.sourceId))
        .map((entry) => ({
          dotM: byId.get(entry.sourceId),
          labelM: ellipsoid.cartesianToCartographic(entry.position).height,
        }));
    });
    // The card lift is 4 m and the dot's is 1 m, so the callout stands exactly
    // 3 m over its own mark — anything else means the two read different floors.
    const drifted = (anchors || []).filter((pair) => Math.abs((pair.labelM - pair.dotM) - 3) > 0.5);
    check('every DETECT callout stands 3 m over its own dot',
      anchors !== null && anchors.length > 0 && drifted.length === 0,
      anchors === null ? 'no dot collection found'
        : `${drifted.length} of ${anchors.length} read a different floor`);
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`FAIL — ${failures.length} finding${failures.length > 1 ? 's' : ''}`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('PASS — every permit stands on the ground it describes.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
