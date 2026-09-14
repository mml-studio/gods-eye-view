#!/usr/bin/env node
/**
 * Deterministic browser proof for the Paris cool-islands layer.
 *
 * Two defects, both of which look like something else, and neither of which a
 * unit test can reach — one is a Cesium primitive's baked position, the other
 * is a key printed over a scene.
 *
 *   i.   THE DOTS STAND ON THE GROUND. Every drawn object was placed at
 *        ellipsoid 0 plus a one-metre lift, tens of metres under the Paris
 *        street it describes, because `cachedGroundFloor` answers over the
 *        NETWORK and nothing came back to re-place what it resolved. Depth
 *        testing is disabled on this layer, so a buried dot is painted anyway
 *        and its screen position becomes a function of the CAMERA POSE: pan
 *        the map and the trees, taps and refuges slide over the rooftops. This
 *        reads the ellipsoidal height back off the PRIMITIVE — not off the
 *        layer's own record, which is where a passing test with a live bug
 *        would hide.
 *   ii.  AND THEY DO NOT MOVE WHEN THE MAP DOES. The reported symptom itself:
 *        the same object is screen-projected before and after a pan-and-return,
 *        and a correctly seated dot comes back to the same pixel.
 *   iii. THE KEY IS THE REGISTERS THAT ARE DRAWING. Four chips, trees off by
 *        default, and a register switched off contributes no rows.
 *   iv.  THE TREE CHIP GATES THE REQUEST, not just the paint: the register is
 *        the only one fetched per viewport, so OFF must cost no round trip.
 *
 * The three refuge registers are intercepted with a fixture so the counts are
 * a fixed truth; the tree box is intercepted too, because the live one depends
 * on where the camera lands.
 *
 * Run: node scripts/qa-fraicheur-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
// The proxy folds this summary into every tree box (`projectFraicheurTrees`),
// and the layer keys its tree bands off it. A fixture that hand-wrote the box
// without it drew twelve trees under a key that never mentioned them — which
// is a fixture that does not match the contract, not a finding. Importing the
// real fold is what makes the interception honest.
import { summarizeFraicheurTrees } from '../src/data/fraicheurTrees.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'fraicheur-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
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

/** The Tuileries, which is the view in the report this harness answers. */
const CITY = { lon: 2.3270, lat: 48.8635 };

/**
 * Ellipsoidal height below which an anchor is judged to be on the ELLIPSOID
 * rather than on Paris.
 *
 * Paris stands ~35 m above the sea and the geoid runs ~+44 m through the
 * Île-de-France, so a real floor there is some 70-90 m of ellipsoidal height.
 * The pre-fix anchor was the 1 m lift alone. Twenty metres is therefore a wide
 * moat around a difference of seventy, not a tuned threshold.
 */
const GROUND_FLOOR_MIN_M = 20;

/**
 * Pixels a dot may shift across a pan-and-return before it counts as sliding.
 *
 * Measured on the sibling defect (`idfm-network`, Latin Quarter, 2026-09-10):
 * a 250 m sideways pan slid a mark up to 269 px, median 140. A seated dot
 * returns to its own pixel; four is the rounding of a screen projection, not a
 * budget for error.
 */
const SLIDE_TOLERANCE_PX = 4;

/** Ten parks, spread so a pan keeps some of them in view. */
function spaceRows() {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const lon = Number((CITY.lon - 0.010 + (i % 5) * 0.005).toFixed(5));
    const lat = Number((CITY.lat - 0.004 + Math.floor(i / 5) * 0.004).toFixed(5));
    const d = 0.0012;
    rows.push({
      id: `space-${i}`,
      ref: `R${i}`,
      name: `Jardin ${i}`,
      // Five under a quarter and five over it: both canopy bands are populated,
      // so a key that printed only one would be a fixture artefact.
      canopy: i < 5 ? 0.02 * i : 0.30 + 0.05 * i,
      canopyM2: 1000 * (i + 1),
      areaM2: 8000,
      // Two declare a heatwave arrangement, and one of those has no canopy at
      // all — the asymmetry the first key row exists to state.
      canicule: i < 2 ? true : false,
      open24: i === 0,
      nocturne: false,
      band: i < 5 ? 'clair' : 'ombrage',
      parts: [[[
        [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d],
      ]]],
      schedule: { periode: null, days: Array(7).fill('08h00 - 20h00') },
    });
  }
  // The one space in 984 that publishes no index at all. It must stay grey and
  // must NOT take a key row of its own.
  rows[9].canopy = null;
  rows[9].band = 'inconnue';
  return rows;
}

/** Six refuges, two per mechanism, so all three families reach the key. */
function equipmentRows() {
  const types = [
    ['Lieux de culte', 'pierre'], ['Musée', 'pierre'],
    ['Ombrière pérenne', 'ombre'], ['Terrain de boules', 'ombre'],
    ['Brumisateur', 'eau'], ['Piscine', 'eau'],
  ];
  return types.map(([type, family], i) => ({
    id: `equip-${i}`,
    ref: `E${i}`,
    name: `${type} ${i}`,
    type,
    family,
    p: [
      Number((CITY.lon - 0.008 + i * 0.003).toFixed(5)),
      Number((CITY.lat + 0.0015).toFixed(5)),
    ],
    paying: false,
    schedule: { periode: null, days: Array(7).fill('09h00 - 18h00') },
  }));
}

/** Eight taps, one of them out of service, so both states reach the key. */
function fountainRows() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `fountain-${i}`,
    ref: `F${i}`,
    street: `Rue ${i}`,
    commune: 'PARIS 1ER ARRONDISSEMENT',
    model: 'FONTNE_WALLACE',
    misting: false,
    available: i !== 3,
    from: null,
    to: null,
    p: [
      Number((CITY.lon - 0.006 + i * 0.002).toFixed(5)),
      Number((CITY.lat - 0.0025).toFixed(5)),
    ],
  }));
}

function refugesPayload() {
  return {
    fetchedAt: new Date().toISOString(),
    spaces: spaceRows(),
    equipment: equipmentRows(),
    fountains: fountainRows(),
    unplaced: 0,
    reusedIds: 0,
    droppedRings: 0,
  };
}

/** Twelve trees, one of them unsurveyed, inside the same block. */
function treesPayload() {
  const trees = Array.from({ length: 12 }, (_, i) => ({
    id: `tree-${i}`,
    name: `Platane ${i}`,
    height: i === 4 ? null : 6 + i,
    girth: 80,
    remarquable: i === 7 ? true : false,
    stage: 'Adulte',
    p: [
      Number((CITY.lon - 0.004 + i * 0.0008).toFixed(5)),
      Number((CITY.lat + 0.0035).toFixed(5)),
    ],
  }));
  return {
    box: {
      south: CITY.lat - 0.01, west: CITY.lon - 0.015, north: CITY.lat + 0.01, east: CITY.lon + 0.015,
    },
    trees,
    truncated: false,
    totalInBox: trees.length,
    budget: 12500,
    summary: summarizeFraicheurTrees(trees),
  };
}

/**
 * The whole-city remarkable register, as the proxy returns it: no box, and
 * every row `remarquable = OUI`. Deliberately placed AWAY from the tree box
 * above, so a dot drawn here cannot be one of those.
 */
function remarkablePayload() {
  const trees = Array.from({ length: 4 }, (_, i) => ({
    id: `rq-${i}`,
    name: `Cèdre remarquable ${i}`,
    height: 22 + i,
    girth: 320,
    remarquable: true,
    stage: 'Adulte',
    p: [
      Number((CITY.lon + 0.006 + i * 0.0012).toFixed(5)),
      Number((CITY.lat - 0.0035).toFixed(5)),
    ],
  }));
  return {
    box: null,
    trees,
    truncated: false,
    totalInBox: trees.length,
    budget: 12500,
    summary: summarizeFraicheurTrees(trees),
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
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
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
      // Deliberately PITCHED and not nadir: a vertical error under a nadir
      // camera is almost no horizontal error at all, which is exactly the pose
      // that would let this defect through.
      orientation: { heading: 0, pitch: -35 * d2r, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

function probe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('fraicheur-fr').module;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;

    // Read what actually reached the SCENE, walking every point collection and
    // keying on the layer's own id prefix — a record that agrees with the
    // ground while the primitive does not is the bug with a passing test.
    const dots = [];
    const primitives = scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const collection = primitives.get(i);
      if (typeof collection?.get !== 'function' || !collection.length) continue;
      const first = collection.get(0);
      if (typeof first?.id !== 'string' || !first.id.startsWith('fraicheur-fr:')) continue;
      for (let n = 0; n < collection.length; n++) {
        const item = collection.get(n);
        const carto = item.position ? ellipsoid.cartesianToCartographic(item.position) : null;
        dots.push({
          id: item.id,
          shown: collection.show !== false && item.show !== false,
          height: carto ? carto.height : null,
        });
      }
    }

    const controls = module.getRowControls();
    return {
      stats: module.getStats(),
      params: module.getParams(),
      chips: controls.chips.map((chip) => ({ id: chip.id, label: chip.label, active: chip.active })),
      legend: controls.legend.map((row) => [row.label, row.count]),
      note: controls.note || '',
      dots,
    };
  });
}

/** Screen position of one drawn dot, by id. Null when it is not projectable. */
function screenOf(page, id) {
  return page.evaluate((wanted) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const primitives = scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const collection = primitives.get(i);
      if (typeof collection?.get !== 'function' || !collection.length) continue;
      for (let n = 0; n < collection.length; n++) {
        const item = collection.get(n);
        if (item?.id !== wanted || !item.position) continue;
        // `scene.cartesianToCanvasCoordinates` and not `SceneTransforms`: the
        // app stopped publishing `Cesium` on the window when the layers were
        // split out of the entry chunk, and a harness that reached for it would
        // silently take the null branch and assert on nothing.
        const out = scene.cartesianToCanvasCoordinates(item.position);
        return out ? { x: out.x, y: out.y } : null;
      }
    }
    return null;
  }, id);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    // Generous, and the reason is measured: this harness sits at 900 m over
    // central Paris with a PITCHED camera, where `scene.render()` is streaming
    // the photorealistic tileset through SwiftShader. The sibling harnesses sit
    // at 6 km over a smaller city and finish in a fraction of this.
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const refuges = refugesPayload();
    const trees = treesPayload();
    const remarkable = remarkablePayload();
    let refugeRequests = 0;
    let treeRequests = 0;
    let remarkableRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/fraicheur-fr/refuges') {
        refugeRequests += 1;
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(refuges) });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/fraicheur-fr/arbres') {
        treeRequests += 1;
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(trees) });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/fraicheur-fr/remarquables') {
        remarkableRequests += 1;
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(remarkable) });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);

    // ── i. the defaults: three registers on, the trees asked for ───────────
    console.log('[qa] i. the four chips, and what is on by default');
    await setView(page, CITY.lon, CITY.lat, 900);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('fraicheur-fr', true));
    let loaded = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      loaded = await probe(page);
      if (refugeRequests >= 1 && !loaded.stats.loading && loaded.stats.count > 0) break;
    }
    check('the city pack is fetched', refugeRequests >= 1, `${refugeRequests} request(s)`);
    // FIVE since 2026-09-14: the 183 remarkable trees became a register of
    // their own when their plugged manifest was withdrawn — same source as
    // ARBRES, but read whole for the city and free of the 1 500 m gate.
    check('one chip per register', loaded.chips.length === 5,
      loaded.chips.map((chip) => chip.label).join(' '));
    check('parks, refuges and taps are on; neither tree register is',
      loaded.params.spaces && loaded.params.equipment && loaded.params.fountains
        && loaded.params.trees === false && loaded.params.remarkable === false,
      JSON.stringify(loaded.params));
    // iv. the chip gates the REQUEST, not just the paint.
    check('and the tree box is never asked for while its chip is off',
      treeRequests === 0, `${treeRequests} request(s)`);
    check('so the key is the three registers that are drawing',
      loaded.legend.length > 0
      && loaded.legend.every(([label]) => !/^Arbre|^Hauteur/.test(label)),
      loaded.legend.map(([label, count]) => `${label}=${count}`).join(' · '));
    // The one space with no published index is REPORTED, never ranked.
    check('the unmeasured canopy is in the note, not in the key',
      !loaded.legend.some(([label]) => /non mesurée/.test(label))
      && /indice de canopée/.test(loaded.note),
      `note="${loaded.note}"`);
    const defaultRows = loaded.legend.length;
    console.log(`  · ${defaultRows} key rows by default: `
      + loaded.legend.map(([label, count]) => `${label} ${count}`).join(' · '));
    await shoot(page, '01-defaults.png');

    // ── ii. the dots stand on the ground ───────────────────────────────────
    //
    // A dot at ellipsoid 0 is not "slightly off": depth testing is disabled so
    // it is painted anyway, and its screen position then follows the camera.
    // The fix reads the floor before placing anything and comes back when a
    // better one lands, so this waits for the settle rather than asserting on
    // the first frame.
    console.log('[qa] ii. the dots stand on the ground');
    let anchored = loaded;
    for (let attempt = 0; attempt < 25; attempt++) {
      const heights = anchored.dots.map((dot) => dot.height);
      if (heights.length && heights.every((h) => Number.isFinite(h) && h > GROUND_FLOOR_MIN_M)) break;
      await pump(page, 3, 60);
      await sleep(400);
      anchored = await probe(page);
    }
    const heights = anchored.dots.map((dot) => dot.height);
    const buried = heights.filter((h) => !Number.isFinite(h) || h <= GROUND_FLOOR_MIN_M).length;
    const lowest = heights.length ? Math.min(...heights) : null;
    const highest = heights.length ? Math.max(...heights) : null;
    console.log(`  · ${heights.length} anchors, `
      + `${lowest === null ? 'n/a' : lowest.toFixed(1)}-${highest === null ? 'n/a' : highest.toFixed(1)} m `
      + `ellipsoidal, ${buried} on the ellipsoid`);
    check('every drawn dot is placed on the ground, not on the ellipsoid',
      heights.length > 0 && buried === 0,
      `${buried} of ${heights.length} still at ellipsoid height`);
    // One city is one floor. Loose on purpose — the failure this guards is not
    // a few metres, it is a dot borrowing the ellipsoid, which is seventy.
    check('and they share one city floor',
      lowest !== null && highest - lowest < 80,
      `${lowest === null ? 'n/a' : (highest - lowest).toFixed(1)} m between lowest and highest`);

    // ── iii. and they do not move when the map does ────────────────────────
    //
    // The reported symptom, measured rather than argued: project one dot, pan
    // 300 m, come back, project it again.
    console.log('[qa] iii. a pan and return leaves them on their own pixel');
    const sample = anchored.dots.find((dot) => dot.shown) || anchored.dots[0];
    const before = sample ? await screenOf(page, sample.id) : null;
    await setView(page, CITY.lon + 0.004, CITY.lat, 900);
    await sleep(900);
    await pump(page, 6, 80);
    await setView(page, CITY.lon, CITY.lat, 900);
    await sleep(900);
    await pump(page, 6, 80);
    const after = sample ? await screenOf(page, sample.id) : null;
    const slide = before && after
      ? Math.hypot(after.x - before.x, after.y - before.y)
      : null;
    console.log(`  · ${sample ? sample.id : 'no dot'} moved ${slide === null ? 'n/a' : slide.toFixed(1)} px`);
    check('the same dot returns to the same pixel',
      slide !== null && slide <= SLIDE_TOLERANCE_PX,
      `${slide === null ? 'not projectable' : `${slide.toFixed(1)} px`}`);
    await shoot(page, '02-returned.png');

    // ── iv. the tree chip brings its register AND its request ──────────────
    console.log('[qa] iv. the ARBRES chip');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('fraicheur-fr', { trees: true }, { origin: 'user' }));
    let withTrees = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      withTrees = await probe(page);
      if (treeRequests >= 1 && withTrees.legend.some(([label]) => /^Arbre|^Hauteur/.test(label))) break;
    }
    check('turning the chip on issues the viewport request', treeRequests >= 1, `${treeRequests}`);
    check('the tree bands join the key', withTrees.legend.length > defaultRows,
      `${defaultRows} → ${withTrees.legend.length} rows`);
    const treeDots = withTrees.dots.filter((dot) => dot.id.startsWith('fraicheur-fr:tree-'));
    check('and the trees are drawn', treeDots.length === trees.trees.length,
      `${treeDots.length} of ${trees.trees.length}`);
    const treeBuried = treeDots.filter((dot) => !Number.isFinite(dot.height)
      || dot.height <= GROUND_FLOOR_MIN_M).length;
    check('on the ground, like everything else', treeBuried === 0,
      `${treeBuried} of ${treeDots.length} on the ellipsoid`);
    await shoot(page, '03-trees-on.png');

    // ── v. and off again, with nothing of it left in the key ───────────────
    console.log('[qa] v. and off again');
    const treeRequestsBefore = treeRequests;
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('fraicheur-fr', { trees: false }, { origin: 'user' }));
    await pump(page, 6, 80);
    await sleep(1200);
    const off = await probe(page);
    check('the tree bands leave the key with their register',
      !off.legend.some(([label]) => /^Arbre|^Hauteur/.test(label)),
      off.legend.map(([label]) => label).join(' · '));
    check('no tree is left drawn',
      off.dots.filter((dot) => dot.id.startsWith('fraicheur-fr:tree-')).length === 0);
    check('and switching it off costs no request',
      treeRequests === treeRequestsBefore, `${treeRequests - treeRequestsBefore} extra`);
    check('the key is back to its default height', off.legend.length === defaultRows,
      `${off.legend.length} rows against ${defaultRows}`);

    // ── vi. the REMARQUABLES chip reaches where the ARBRES chip cannot ─────
    //
    // The point of the register: `FRAICHEUR_TREE_MAX_ALTITUDE_M` refuses a tree
    // box above 1 500 m, and these 183 are read whole for the city, so they are
    // the only canopy a reader looking at Paris entire can ask for. Proved at
    // 4 000 m, where the ordinary register is dormant by contract.
    console.log('[qa] vi. the REMARQUABLES chip, from a view the ARBRES chip refuses');
    await setView(page, CITY.lon, CITY.lat, 4000);
    await sleep(900);
    await pump(page, 6, 80);
    const treeRequestsAtAltitude = treeRequests;
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('fraicheur-fr', { remarkable: true }, { origin: 'user' }));
    let withRemarkable = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      withRemarkable = await probe(page);
      if (remarkableRequests >= 1
        && withRemarkable.dots.some((dot) => dot.id.startsWith('fraicheur-fr:rq:'))) break;
    }
    check('the chip asks the whole-city register, with no box',
      remarkableRequests >= 1, `${remarkableRequests}`);
    const remarkableDots = withRemarkable.dots
      .filter((dot) => dot.id.startsWith('fraicheur-fr:rq:'));
    check('and the remarkable trees are drawn from 4 000 m',
      remarkableDots.length === remarkable.trees.length,
      `${remarkableDots.length} of ${remarkable.trees.length}`);
    check('while the ordinary tree register stays dormant up here',
      treeRequests === treeRequestsAtAltitude,
      `${treeRequests - treeRequestsAtAltitude} tree request(s) at 4 000 m`);
    check('the band joins the key with the count the city published',
      withRemarkable.legend.some(([label, count]) => /^Arbre remarquable/.test(label)
        && Number(count) === remarkable.trees.length),
      withRemarkable.legend.map(([label, count]) => `${label} ${count}`).join(' · '));

    // Asked for ONCE: the register is frozen, and a camera move must not re-buy it.
    const remarkableRequestsBefore = remarkableRequests;
    await setView(page, CITY.lon + 0.01, CITY.lat, 4000);
    await sleep(900);
    await pump(page, 6, 80);
    check('and never asked for twice', remarkableRequests === remarkableRequestsBefore,
      `${remarkableRequests - remarkableRequestsBefore} extra`);

    // The 403 is the Google photorealistic tileset's `root.json` refused inside
    // the EEA, and it is NOMINAL on this machine — the app falls back to the
    // Cesium ion asset and every other harness in this repo sees it too.
    // Counting it would make this harness red on a healthy tree.
    const fatal = consoleErrors.filter((text) => !/favicon|ResizeObserver|status of 403/i.test(text));
    check('no unexpected console error', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] FAIL — ${failures.length} check(s):`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[qa] PASS');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
